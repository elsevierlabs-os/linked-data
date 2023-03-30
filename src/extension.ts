// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as $rdf from 'rdflib';
import { parse } from 'yaml';
const jsonld = require('jsonld');
const ShaclValidator = require('schemarama/shaclValidator').Validator;
const slugify = require('slugify');

import { rawListeners, report } from 'process';
import { RDFArrayRemove } from 'rdflib/lib/utils-js';
import { GraphType } from 'rdflib/lib/types';
import { DefaultGraph } from 'rdflib/lib/tf-types';
import { isSubject } from 'rdflib';

const STRICT_NQUADS_REGEX = /(<\S+?>|_:\S+)?\s+(<\S+?>)\s+(<\S+?>|_:\S+?|(".*"(^^<.+>)?))\s+(<\S+?>|_:\S+?)\s*\.(\s*#.+)?/g;

interface GVResponse {
	mediaType: string,
	message: any,
	status: boolean
};



// Pluck prefixes from the JSON-LD @context and push into the RDF serializer
// Only works for local contexts (not remote ones)
function suggestContextPrefixes(json: any, rdfSerializer: any) {

	var _processContext = function (contextObj: any) {
	  Object.keys(contextObj).forEach((key) => {
		if (key.indexOf(':') < 0 && key.indexOf('@') < 0) {
		  var prefix = "";
		  if (typeof contextObj[key] === 'object' && !Array.isArray(contextObj[key]) && contextObj[key] !== null) {
			prefix = contextObj[key]["@id"];
		  } else {
			prefix = contextObj[key];
		  }
		  rdfSerializer.suggestPrefix(key, prefix);
		} else if (key == '@context') {
		  _getContext(contextObj[key]);
		}
	  });
	};

	var _getContext = function (context: any) {
	  // If there is no context, there are no prefixes to suggest.
	  if (!context) {
		return;
	  }
	  if (Array.isArray(context)) {
		context.forEach((contextObj) => { _processContext(contextObj) });
	  } else {
		_processContext(context);
	  }
	};

	if (json != undefined) {
	  if (Array.isArray(json)) {
		json.forEach((jsonObj) => { _getContext(jsonObj["@context"]) });
	  } else {
		_getContext(json["@context"]);
	  }
	}
  }

async function JSONLDtoNQuads(data: string){
	// Convert JSON-LD to NQuads through jsonld.js as it is much better at parsing JSON-LD than rdflib.js
	const data_object = JSON.parse(data);

	return jsonld.toRDF(data_object, {format: 'application/n-quads'});
}



// Load the RDF contained in the string into a triple store and return resolved Promise
function loadRDF(data: string, rdfStore: $rdf.Store, mediaType: string) {
	if(mediaType == undefined) {
		mediaType = "application/ld+json";
	}

	return new Promise<$rdf.Store>((resolve, reject) => {
		try {

			if (mediaType == "application/ld+json") {
				JSONLDtoNQuads(data)
					.then(nquads => $rdf.parse(nquads, rdfStore, "https://example.com/test/", "application/n-quads", function () {
						vscode.window.showInformationMessage("Successfully parsed: Statements in the graph: " + rdfStore.length);
						resolve(rdfStore);
					}));
			} else {
				$rdf.parse(data, rdfStore, "https://example.com/test/", mediaType, function () {
					vscode.window.showInformationMessage("Successfully parsed: Statements in the graph: " + rdfStore.length);
					resolve(rdfStore);
			});
			}

		} catch (err:any) {
			vscode.window.showErrorMessage(`Failed to load data into triplestore as ${mediaType}!`, err);
			reject(err);
		}
	});
  }

function serializeRDF(rdfStore: $rdf.Store, mediaType: string) {
	if(mediaType == undefined) {
		mediaType = "application/ld+json";
	}

	return new Promise<string|undefined>((resolve, reject) => {
		try {
			$rdf.serialize(null, rdfStore, undefined, mediaType, function (err, result) {
				if(mediaType == 'application/ld+json') {
					result = JSON.stringify(JSON.parse(result as string), undefined, 4);
				}
				resolve(result);
			});
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to serialize store to ${mediaType}!`, err);
			console.log(`Failed to serialize store to ${mediaType}!`);
			reject(err);
		}
	});

}


async function runQuery(query: string, documentText: string, mediaType: string): Promise<any[]> {
	var store = $rdf.graph();
	
	var result:any[] = []
	await loadRDF(documentText, store, mediaType).then((store: $rdf.Store) => {
		const queryObject = $rdf.SPARQLToQuery(query, false, store) as $rdf.Query;

		result = store.querySync(queryObject)
	}).catch((reason) => {
		return [reason];
	}).finally(() => {
		console.log("Finally...");
	});
	return result;
}



async function getView(documentText: string, mediaType: string, showTypes: boolean): Promise<GVResponse> {
	var store = $rdf.graph();
	var serializer = $rdf.Serializer(store);

	if (mediaType == 'application/ld+json') {
		suggestContextPrefixes(JSON.parse(documentText),serializer);
	}
	
	var result:GVResponse = {status: false, message: "initialized", mediaType: "unknown"};
	await loadRDF(documentText, store, mediaType).then((store: $rdf.Store) => {
		const d3graph = buildD3Graph(store, serializer, showTypes);
		result = {status: true, message: d3graph, mediaType: ""}; 
	}).catch((reason) => {
		result = {status: false, message: reason, mediaType: ""};
	}).finally(() => {
		console.log("Finally...");
	});
	return result;
}

async function toSerialization(documentText: string, fromMediaType: string, toMediaType: string): Promise<GVResponse> {
	var store = $rdf.graph();
	var serializer = $rdf.Serializer(store);

	if(fromMediaType == 'application/ld+json' || fromMediaType == 'text/json') {
		suggestContextPrefixes(JSON.parse(documentText), serializer);
	}
	
	var result:GVResponse = {status: false, message: "initialized", mediaType: "unknown"};
	await loadRDF(documentText, store, fromMediaType).then((store: $rdf.Store) => {
		return serializeRDF(store, toMediaType);
	}).then((data) => {
		result = {status:true, message: data, mediaType: toMediaType};
	}).catch((reason) => {
		result = {status: false, message: reason.toString(), mediaType: ""};
		vscode.window.showErrorMessage(`Something went wrong while trying to parse from ${fromMediaType} to ${toMediaType}`);
	}).finally(() => {
		return result;
	});
	return result;
}

class Attribute {
	property: string = "";
	value: string = ""
}

class Node {
	id: string = "";
	name: string = "";
	uri: string = "";
	group: string= "";
	attributes: Array<Attribute> = [];
	type: Array<string> = [];
}




function buildD3Graph(store: $rdf.Store, serializer: any, showTypes: boolean): {} {
	const RDF_TYPE: $rdf.NamedNode = $rdf.sym("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
	const RDFS_SUBCLASSOF: $rdf.NamedNode = $rdf.sym("http://www.w3.org/2000/01/rdf-schema#subClassOf");

	var nodesObject: Map<string,Node> = new Map();
	var links: any = [];
	var nodes: Array<Node> = [];

	const statements: Array<$rdf.Statement> = store.statementsMatching(null, null, null, null);

	for(let s of statements) {
		// local function
		processStatement(s);
	}

	// Transform the nodes object to an array of nodes.
	nodesObject.forEach(function(node: Node){
		nodes.push(node);
	})
	return {
		nodes: nodes,
		links: links
	}

	function getOrCreateNode(qname: string, name: string, uri: string, group: string, nodesObject: Map<string,Node> ): any {
		let node: Node = new Node();
		
		let safeURI = uri.replace("<","&lt;").replace(">","&gt;");
	
		if (!nodesObject.has(qname)) {
			// Add the resource node if it does not already exist
			node.id = qname;
			node.name = name;
			node.uri = safeURI;
			node.group = group;
			node.type = [];
			node.attributes = [];
			// Add it to the nodes object just to be sure (so that it's there even if it's not updated later)
			nodesObject.set(qname, node);
		} else {
			// Otherwise, retrieve it so that we can update it (we know it's never undefined)
			node = nodesObject.get(qname) as Node;
			if (node == undefined) {
				throw "Resource is undefined, but this is impossible.";
			}
		}
		return node;
	}

	function processStatement(s:$rdf.Statement) {

		// Skip type triples if showTypes is false
		if (!showTypes && (s.predicate.value == RDF_TYPE.value)) {
			return
		}

		let s_qname: string = buildId(s.subject, serializer);
		let p_qname: string = buildId(s.predicate, serializer);
		let o_qname: string = buildId(s.object, serializer);

		let g_qname: string = buildId(s.graph, serializer);

		// Always add the graph as node if it is not the DefaultGraph.
		if (g_qname != "DefaultGraph") {
			let graph = getOrCreateNode(g_qname, g_qname, s.graph.toString(), g_qname, nodesObject);
			// Add the "@graph" type to the types for this node.
			if (!graph.type.includes('@graph')) {
				graph.type.push("@graph");
			}
		}

		if ($rdf.isNamedNode(s.object)||$rdf.isBlankNode(s.object)) {
			// Get the subject node, or create one if it does not already exist.
			let subject = getOrCreateNode(s_qname, s_qname, s.subject.toNT(), s_qname, nodesObject);
			// Add type to node as attribute (rather than as edge to the graph)
			if (s.predicate.equals(RDF_TYPE)) {

				let types = subject.type as Array<string>;

				if (!types.includes(o_qname)) {
					types.push(o_qname);
					subject.type = types;
				}
			}
			// update the dictionary of nodes
			nodesObject.set(s_qname, subject);

			// Get or create the object node; in its own group (not a literal)
			let object = getOrCreateNode(o_qname, o_qname, s.object.toNT(), o_qname, nodesObject);
			nodesObject.set(o_qname, object);


			// Add the link between subject and object
			let link = {
				source: s_qname,
				target: o_qname,
				id: safeJSIdentifier(s_qname+p_qname+o_qname),
				name: p_qname, 
				graph: g_qname
			};

			links.push(link);
		} else if ($rdf.isLiteral(s.object)) {
			// Get the subject, and its attributes
			let subject = getOrCreateNode(s_qname, s_qname, s.subject.toNT(), s_qname, nodesObject);
			let attributes = subject.attributes;

			// If the attribute is not already defined on the node
			if (attributes.find((x: { property: string; value: string; }) => x.property == p_qname && x.value == o_qname) == undefined) {
			
				if (attributes == undefined) {
					throw "Attributes are undefined, that should not be possible";
				}
				// Create a new attribute/value pair
				let attr:Attribute = {
					"property": p_qname,
					"value": o_qname
				};
				// Add it to the attributes, the subject node, and update the nodes object.
				attributes.push(attr);
				subject.attributes = attributes;

				nodesObject.set(s_qname, subject);

				// Get or create the object node; in the group of the subject.
				let literal_value_node_id = safeJSIdentifier(s_qname+p_qname+o_qname);

				let object = getOrCreateNode(literal_value_node_id, s.object.toString(), s.object.toString(), s_qname, nodesObject);
				// Set the object type to Literal
				object.type = ["Literal"];
				nodesObject.set(literal_value_node_id, object);


				// Add the link between subject and object
				let link = {
					source: s_qname,
					target: literal_value_node_id,
					id: literal_value_node_id, // Equivalent to subject + predicate + object
					name: p_qname,
					graph: g_qname
				};

				links.push(link);
			}
		}
	}
}

function safeJSIdentifier(value:string) {
	return `id_${value}`.replace(/\W/g, '_').toLowerCase();
}

function buildId(term: $rdf.Node|GraphType|DefaultGraph, serializer: any){
	if ($rdf.isGraph(term) && term.toString() == "DefaultGraph") {
		return term.toString()
	} else if ($rdf.isNamedNode(term) || $rdf.isBlankNode(term) || $rdf.isGraph(term)){
		if(term.value.startsWith('_')){
			return term.value;
		}
		return serializer.atomicTermToN3(term).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	} else if ($rdf.isLiteral(term)){
		return term.toString();
	} else if ($rdf.isCollection(term)) {
		throw "Unfortunately collections (lists) are not supported. Try converting to Turtle or N-Quads first.";
	} else {
		throw "This is impossible!"
	}
}



function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

async function updateGraphView(document:vscode.TextDocument, extensionUri: vscode.Uri) {
	let { data, fromMediaType } = await getDataAndMediaType(document);
	const documentName = document.fileName;

	let config = vscode.workspace.getConfiguration("linked-data");
	let showTypes = config.get('showTypes');

	if (!showTypes) {
		vscode.window.showInformationMessage("Hiding nodes and edges for types");
	} 
	
	await getView(data, fromMediaType, showTypes as boolean).then((result) => {
		if(result.status){
			// Create and show a new webview
			const panel = vscode.window.createWebviewPanel(
				'linked-data', // Identifies the type of the webview. Used internally
				'Graph: '+documentName, // Title of the panel displayed to the user
				vscode.ViewColumn.Two, // Editor column to show the new webview panel in.
				{
					// Enable scripts in the webview
					enableScripts: true
				}
			);
			
			const inspector = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'inspector.js'));
			// Get the local path to scripts run in the webview, then convert it to a uri we can use in the webview.
			
			

			// Produce the required script tags to be put in the HTML head.
			const nonce = getNonce();
			
			var html:string = `
			<!DOCTYPE html>
  			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Graph Viewer</title>
					<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
					-->
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline' https:; img-src ${panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}' 'unsafe-inline'; font-src ${panel.webview.cspSource}; connect-src https: http: ;">
					
					<script nonce="${nonce}" src="${inspector}"></script>

					<script id="data">${JSON.stringify(result.message)}</script>
				</head>
				<body>
					<div>
						<div id="tooltip"></div>
						<svg id="graph" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMin slice"></svg>
					</div>
				</body>
			</html>`;

			panel.webview.html = html;
			return
		} else {
			vscode.window.showErrorMessage(result.message);

		}

		
		
	});
}

async function getJSONwithEmbeddedContext(json_document: vscode.TextDocument) {
	const dirname = path.dirname(json_document.uri.fsPath);
	var json_text = json_document.getText();
	var json_object = JSON.parse(json_text);

	let config = vscode.workspace.getConfiguration("linked-data");
	let loadLocalContexts = config.get('loadLocalContexts');

	if (!loadLocalContexts || !json_object['@context']) {
		return(json_object);
	} else {
		vscode.window.showInformationMessage("Will attempt to load local contexts");
	}

	try {
		let context = json_object['@context']

		if (typeof context === 'object' && context.constructor !== Array) {
			// This file has an object-context, returning as is.
			return json_object;
		} else if (typeof context === 'string') {
			// This file has a string as context, turning it into an array
			context = [context];
		}

		// If the context is an array, we're going to loop through the elements
		// for each element that is a string, we're going interpret that string as a filename, and will 
		// try to load the contents into an object, and inject it back into the context.
		if (context.constructor === Array) {
			let expandedContextArray:any[] = [];
			for (let c in context) {

				if (typeof context[c] == 'string') {
					const json_context_path = path.join(dirname, context[c]);
					const json_context_doc = await vscode.workspace.openTextDocument(json_context_path);
					expandedContextArray.push(JSON.parse(json_context_doc.getText()));
					vscode.window.showInformationMessage(`Including context from ${json_context_path}`);
				} else {
					// Just passing through the value in the context array, as it may be an object or another array.
					expandedContextArray.push(context[c]);
				}
			}
			json_object['@context'] = expandedContextArray;
		}
	} catch (e: any) {
		vscode.window.showErrorMessage(e.message);
		console.log("Could not load context from files");
	}
	return json_object;
}



// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	console.log('The extension "linked-data" is now active!');


	let disposableViewer = vscode.commands.registerCommand('linked-data.view', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			let document = editor.document ;
			const extensionUri = context.extensionUri;
		

			await updateGraphView(document, extensionUri);

			

			return;
		}
	});

	let disposableCompacter = vscode.commands.registerCommand('linked-data.compact', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			try {
				let document = editor.document ;

				const documentJSON = await getJSONwithEmbeddedContext(document);
				const compacted = await jsonld.compact(documentJSON, documentJSON);
				const compactedString = JSON.stringify(compacted, null, 2);
				
				let doc = await vscode.workspace.openTextDocument({content: compactedString, language: "json"});
				await vscode.window.showTextDocument(doc, {preview: false});
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
		}
	});

	let disposableExpander = vscode.commands.registerCommand('linked-data.expand', async () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {	
			try {	
				let document = editor.document ;
				const documentJSON = await getJSONwithEmbeddedContext(document);
				const expanded = await jsonld.expand(documentJSON);
				const expandedString = JSON.stringify(expanded, null, 2);
				let doc = await vscode.workspace.openTextDocument({content: expandedString, language: "json"});
				await vscode.window.showTextDocument(doc, {preview: false, viewColumn: vscode.ViewColumn.Beside});
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
				return;
			}
			

			
		} 
	});

	let disposableFlattener = vscode.commands.registerCommand('linked-data.flatten', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {

			try {
				let document = editor.document ;

				const documentJSON = await getJSONwithEmbeddedContext(document);
				const documentName = document.fileName;
				const flattened = await jsonld.flatten(documentJSON);
				const flattenedString = JSON.stringify(flattened, null, 2);

				let doc = await vscode.workspace.openTextDocument({content: flattenedString, language: "json"});
				await vscode.window.showTextDocument(doc, {preview: false});
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableFramer = vscode.commands.registerCommand('linked-data.frame', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {

			try {
				let document = editor.document ;

				const documentJSON = await getJSONwithEmbeddedContext(document);
				

				const documentName = document.fileName;
				const options = {title: 'Select a JSON/JSON-LD file to use as frame.', openLabel: 'Open JSON-LD Frame', filters: {'JSON/JSON-LD Files': ['json', 'jsonld']}};

				let frameFileURI = await vscode.window.showOpenDialog(options);
				if (!frameFileURI) {
					throw Error("No file selected!");
				}

				const frameDocument = await vscode.workspace.openTextDocument(frameFileURI[0]);
				const frameJSON = JSON.parse(frameDocument.getText());
	
				const framed = await jsonld.frame(documentJSON, frameJSON);
				const framedString = JSON.stringify(framed, null, 2);
				
				let doc = await vscode.workspace.openTextDocument({content: framedString, language: "json"});
				vscode.window.showInformationMessage(`Framed document ${documentName} using ${frameFileURI[0].toString()}`);
				await vscode.window.showTextDocument(doc, {preview: false});
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableQuads = vscode.commands.registerCommand('linked-data.quads', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			try {
				let document = editor.document ;
				let toMediaType:string = "application/n-quads";
				let targetLanguage:string = "turtle";
				await doFormatConversion(document, toMediaType, targetLanguage);
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableTurtle = vscode.commands.registerCommand('linked-data.turtle', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			try {
				let document = editor.document ;
				let toMediaType:string = "text/turtle";
				let targetLanguage:string = "turtle";
				await doFormatConversion(document, toMediaType, targetLanguage);
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableRDF = vscode.commands.registerCommand('linked-data.rdf', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			try {
				let document = editor.document ;
				let toMediaType:string = "application/rdf+xml";
				let targetLanguage:string = "xml";
				await doFormatConversion(document, toMediaType, targetLanguage);
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableJSONLD = vscode.commands.registerCommand('linked-data.jsonld', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			try {
				let document = editor.document ;
				let toMediaType:string = "application/ld+json";
				let targetLanguage:string = "json";
				await doFormatConversion(document, toMediaType, targetLanguage);
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableValidator = vscode.commands.registerCommand('linked-data.validate', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {

			try {
				let document = editor.document ;

				// Try to obtain YAML configuration from comments at the top of the query 
				const re = /^(#.+\n)+/;
				const m = document.getText().match(re);
				var shaclFileName;

				if(m){
					// If we have a result, take the first hit, and try to parse as YAML
					try {
						// Replace all starting hash-characters with nothing to make it parseable as YAML.
						let configLines = m[0].replace(/^#/,"")
						
						let config = parse(configLines);
						shaclFileName = config.shapes;

					} catch {
						vscode.window.showErrorMessage("Could not parse comments as YAML, or YAML does not define `file` attribute.");
					}
				}

				var shaclFileURI:vscode.Uri;
				if(shaclFileName!=undefined){
					// Take the parent path of the current document, so that we can parse the shaclFileName as relative path
					let parentPath = path.parse(document.uri.fsPath).dir;
					shaclFileURI = vscode.Uri.joinPath(vscode.Uri.file(parentPath), shaclFileName);
				} else {
					const options = {title: 'Select the file that contains your SHACL shapes.', openLabel: 'Open SHACL shapes', filters: {'RDF Files': ['json', 'jsonld', 'ttl', 'nq', 'nt', 'rdf', 'owl']}};
				
					let shaclFileURIs = await vscode.window.showOpenDialog(options);
					if (!shaclFileURIs) {
						throw Error("No file selected!");
				}
					shaclFileURI = shaclFileURIs[0];
				}

				const shaclDocument = await vscode.workspace.openTextDocument(shaclFileURI);

				const result = await validate(document, shaclDocument);

				// No failures? File is valid!
				if(result.failures.length==0) {
					vscode.window.showInformationMessage("Congratulations, your file is valid!");
					return;
				} 
				// If we do have failures, let's show them.
				vscode.window.showWarningMessage("Alas, your file is not valid.");

				const variables = ["node", "message", "shape", "property", "severity"];
				const data = result.failures;

				const panel = vscode.window.createWebviewPanel(
					'linked-data', // Identifies the type of the webview. Used internally
					'SHACL Results: '+document.fileName, // Title of the panel displayed to the user
					vscode.ViewColumn.Two, // Editor column to show the new webview panel in.
					{
						// Enable scripts in the webview
						enableScripts: true
					}
				);
				
				// Produce the required script tags to be put in the HTML head.
				const nonce = getNonce();
				
				var html:string = `
				<!DOCTYPE html>
				  <html lang="en">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>SPARQL Results</title>
						<!--
						Use a content security policy to only allow loading images from https or from our extension directory,
						and only allow scripts that have a specific nonce.
						-->
						<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline' https:; img-src ${panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}' 'unsafe-inline'; font-src ${panel.webview.cspSource}; connect-src https: http: ;">
						
	
						
						<link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
					</head>
					<body>
					  <div id="container" style="padding: 1em; box-sizing: border-box; max-width: 100%; overflow: scroll; align-items: center; justify-content: center;">
					  	<div id="wrapper"></div>
					  </div>
					  <script nonce="${nonce}" src="https://unpkg.com/gridjs/dist/gridjs.umd.js"></script>
					  <script nonce="${nonce}" >
					  new gridjs.Grid({
						columns: ${JSON.stringify(variables)},
						data: ${JSON.stringify(data)},
						sort: true,
						pagination: true,
						search: true,
						resizable: true
					  }).render(document.getElementById("wrapper"));
					  </script>
					</body>
				</html>`;
	
				panel.webview.html = html;
				
				let doc = await vscode.workspace.openTextDocument({content: result, language: "json"});
				vscode.window.showTextDocument(doc, {preview: false});
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	let disposableSPARQLer = vscode.commands.registerCommand('linked-data.query', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {

			try {
				let document = editor.document ;
				
				const documentName = document.fileName;
				const query = document.getText();

				// Try to obtain YAML configuration from comments at the top of the query 
				const re = /^(#.+\n)+/;
				const m = query.match(re);
				var dataFileName;

				if(m){
					// If we have a result, take the first hit, and try to parse as YAML
					try {
						// Replace all starting hash-characters with nothing to make it parseable as YAML.
						let configLines = m[0].replace(/^#/,"")
						
						let config = parse(configLines);
						dataFileName = config.file;

					} catch {
						vscode.window.showErrorMessage("Could not parse comments as YAML, or YAML does not define `file` attribute.");
					}
				}

				var dataFileURI:vscode.Uri;
				if(dataFileName!=undefined){
					// Take the parent path of the current document, so that we can parse the dataFileName as relative path
					let parentPath = path.parse(document.uri.fsPath).dir;
					dataFileURI = vscode.Uri.joinPath(vscode.Uri.file(parentPath), dataFileName);
				} else {
					const options = {title: 'Select the file that contains your data.', openLabel: 'Open Linked Data', filters: {'RDF Files': ['json', 'jsonld', 'ttl', 'nq', 'nt', 'rdf', 'owl']}};

					let dataFileURIs = await vscode.window.showOpenDialog(options);
					if (!dataFileURIs) {
						throw Error("No file selected!");
					}
					dataFileURI = dataFileURIs[0];
				}

				


				// Get the data to query
				const dataDocument = await vscode.workspace.openTextDocument(dataFileURI);

				let documentInfo  = await getDataAndMediaType(dataDocument);
	
				const result = await runQuery(query, documentInfo.data, documentInfo.fromMediaType);

				var variables:string[] = [];
				var data = [];

				if (result.length > 0) {
					// Iterate over the keys of the first result to obtain the array of variables.
					for(let v in result[0]){
						variables.push(v);
					}

					for(let r of result){
						let stringresult = [];
						for(let v of variables){
							stringresult.push(r[v].value);
						}
						data.push(stringresult);
					}
					
				}

				// Build a CSV file
				let csv:any[] = data;
				csv.unshift(variables)
				let csvstring:string = csv.map(function(row){
					let rowstring:string = row.map(function(d:string[]){
						return JSON.stringify(d);
					}).join(";");
					return rowstring;
				}).join('\n');
				let doc = await vscode.workspace.openTextDocument({content: csvstring, language: "csv"});
				await vscode.window.showTextDocument(doc, vscode.ViewColumn.Two);


				// Build a webview with the results
				const panel = vscode.window.createWebviewPanel(
					'linked-data', // Identifies the type of the webview. Used internally
					'SPARQL Results: '+documentName, // Title of the panel displayed to the user
					vscode.ViewColumn.Two, // Editor column to show the new webview panel in.
					{
						// Enable scripts in the webview
						enableScripts: true
					}
				);
				
				// Produce the required script tags to be put in the HTML head.
				const nonce = getNonce();
				
				var html:string = `
				<!DOCTYPE html>
				  <html lang="en">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>SPARQL Results</title>
						<!--
						Use a content security policy to only allow loading images from https or from our extension directory,
						and only allow scripts that have a specific nonce.
						-->
						<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource} 'unsafe-inline' https:; img-src ${panel.webview.cspSource} https: data:; script-src 'nonce-${nonce}' 'unsafe-inline'; font-src ${panel.webview.cspSource}; connect-src https: http: ;">
						
	
						
						<link href="https://unpkg.com/gridjs/dist/theme/mermaid.min.css" rel="stylesheet" />
					</head>
					<body>
					<h2>Query Results</h2>
					  <div id="container" style="padding: 1em; box-sizing: border-box; max-width: 100%; overflow: scroll; align-items: center; justify-content: center;">
					    <h3>Query</h3>
					    <div id="query">
							<pre>
${query}
							</pre>
						</div>
						<h3>Results</h3>
					  	<div id="wrapper"></div>
					  </div>
					  <script nonce="${nonce}" src="https://unpkg.com/gridjs/dist/gridjs.umd.js"></script>
					  <script nonce="${nonce}" >
					  new gridjs.Grid({
						columns: ${JSON.stringify(variables)},
						data: ${JSON.stringify(data)},
						sort: true,
						pagination: true,
						search: true,
						resizable: true
					  }).render(document.getElementById("wrapper"));
					  </script>
					</body>
				</html>`;
	
				panel.webview.html = html;
				return
				
				
			} catch(e: any) {
				vscode.window.showErrorMessage(e.message);
			}
			
		}
	});

	context.subscriptions.push(disposableViewer);
	context.subscriptions.push(disposableCompacter);
	context.subscriptions.push(disposableExpander);
	context.subscriptions.push(disposableFlattener);
	context.subscriptions.push(disposableFramer);
	context.subscriptions.push(disposableTurtle);
	context.subscriptions.push(disposableQuads);
	context.subscriptions.push(disposableRDF);
	context.subscriptions.push(disposableJSONLD);
	context.subscriptions.push(disposableValidator);
	context.subscriptions.push(disposableSPARQLer);
}


async function doFormatConversion(document: vscode.TextDocument, toMediaType: string, targetLanguage: string) {
	let { data, fromMediaType } = await getDataAndMediaType(document);
	if (toMediaType == fromMediaType) {
		vscode.window.showErrorMessage(`The file is already in the ${toMediaType} format`);
		return;
	} 
	if (fromMediaType == 'application/trig') {
		vscode.window.showErrorMessage(`Unfortunately the TriG format is not supported`);
		return;
	}

	const result = await toSerialization(data, fromMediaType, toMediaType);
	if (result.status) {
		let doc = await vscode.workspace.openTextDocument({ content: result.message, language: targetLanguage });
		await vscode.window.showTextDocument(doc, { preview: false });
	} else {
		vscode.window.showErrorMessage(result.message);
	}
}

async function getDataAndMediaType(document: vscode.TextDocument) {
	let data:string = "";
	let fromMediaType:string = "";

	if (document.languageId == 'json' || document.languageId == 'jsonld') {
		const documentJSON = await getJSONwithEmbeddedContext(document);
		data = JSON.stringify(documentJSON);
		fromMediaType = "application/ld+json";
	} else if (document.languageId == 'turtle') {
		data = document.getText();

		// Performing a strict check on NQuads (must have a graph), otherwise we'll parse as Turtle
		if(data.match(STRICT_NQUADS_REGEX)) {
			fromMediaType = "application/n-quads"
		} else {
			fromMediaType = "text/turtle";
		}
	} else if (document.languageId == "trig") {
		data = document.getText();
		fromMediaType = "application/trig";
	} else if (document.languageId == "xml") {
		data = document.getText();
		fromMediaType = "application/rdf+xml"
	} else {
		vscode.window.showErrorMessage("Cannot establish file type. Should be json/json-ld, turtle, trig or xml/rdf+xml. N-Triples and N-Quads are automatically derived from Turtle. Make sure you have the Stardog RDF syntaxes extension installed!");
	}
	return { data, fromMediaType };
}


async function validate(document: vscode.TextDocument, shaclDocument: vscode.TextDocument):Promise<any> {
	let doc  = await getDataAndMediaType(document);
	let shapes = await getDataAndMediaType(shaclDocument);
	let store = new $rdf.Store();
	let shapesStore = new $rdf.Store();

	await loadRDF(doc.data, store, doc.fromMediaType);
	let data = await serializeRDF(store, 'application/ld+json');

	await loadRDF(shapes.data, shapesStore, shapes.fromMediaType);
	let shapesData = await serializeRDF(shapesStore, 'text/turtle');


	const validator = new ShaclValidator(shapesData, {annotations: {"node": "http://www.w3.org/ns/shacl#focusNode", "label": "http://www.w3.org/2000/01/rdf-schema#label"}});
	let report = await validator.validate(data, {baseUrl: "http://example.org/test"});
	return(report);
  }


// this method is called when your extension is deactivated
export function deactivate() {}


