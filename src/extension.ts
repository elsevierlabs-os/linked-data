// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { parse } from 'yaml';
import axios from 'axios';
const jsonld = require('jsonld');
const ShaclValidator = require('schemarama/shaclValidator').Validator;
import { Store, Quad, NamedNode, BlankNode, Literal, DefaultGraph as DefaultGraphOxi, namedNode } from 'oxigraph/node.js';
import { prefixes } from './prefixes';

const STRICT_NQUADS_REGEX = /(<\S+?>|_:\S+)?\s+(<\S+?>)\s+(<\S+?>|_:\S+?|(".*"(^^<.+>)?))\s+(<\S+?>|_:\S+?)\s*\.(\s*#.+)?/g;

interface GVResponse {
	mediaType: string,
	message: any,
	status: boolean
};

let outputChannel: vscode.OutputChannel;



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
	// Convert JSON-LD to NQuads through jsonld.js
	const data_object = JSON.parse(data);
	
	try {
		return await jsonld.toRDF(data_object, {format: 'application/n-quads'});
	} catch (err:any) {
		outputChannel.appendLine("Could not convert JSON-LD to NQuads");
		outputChannel.appendLine(err);
		throw err 
	}
	
}


function serializeRDFOxigraph(store: Store, mediaType: string){
	if(mediaType == undefined) {
		mediaType = "application/ld+json";
	}

	return new Promise<string|undefined>((resolve, reject) => {
		try {
			console.log("oxigraph serialization");
			if(mediaType == 'application/ld+json') {
				let nquadsResult = store.dump("application/n-quads", null); 
				jsonld.fromRDF(nquadsResult, {format: 'application/n-quads'}).then((jsonldResult: any) => {
					var result = JSON.stringify(jsonldResult as string, undefined, 4);
					resolve(result);
				});
			} else {
				var result = store.dump(mediaType,null);
				resolve(result)
			}
			
		} catch (err: any) {
			outputChannel.appendLine(`Oxigraph: Failed to serialize store to ${mediaType}! ` + err);
			console.log(err);
			reject(err)
		}
	})

}

function loadRDFOxigraph(data: string, oxiStore: Store, mediaType: string) {
	if(mediaType == undefined) {
		mediaType = "application/ld+json";
	}

	return new Promise<Store>((resolve, reject) => {
		try {

			if (mediaType == "application/ld+json") {
				outputChannel.appendLine("Converting JSON-LD to NQuads to preserve named graphs");
				JSONLDtoNQuads(data)
					.then(nquads => {
						oxiStore.load(nquads, "application/n-quads", undefined, undefined);
						outputChannel.appendLine("Successfully parsed: Statements in the graph: " + oxiStore.size);
						resolve(oxiStore);
					}).catch((reason) => {
						outputChannel.appendLine("Could not parse JSON-LD into graph")
						outputChannel.appendLine(reason);
						reject(reason);
					});
			} else {
				oxiStore.load(data, mediaType, undefined, undefined);
				outputChannel.appendLine("Successfully parsed: Statements in the graph: " + oxiStore.size);
				resolve(oxiStore);
			}
		} catch (err:any) {
			outputChannel.appendLine(`Failed to load data into triplestore as ${mediaType}!` + err);
			reject(err);
		}
	});

}


async function runQuery(query: string, documentText: string, mediaType: string): Promise<any[]> {
	var oxiStore = new Store();
	var result:any[] = [];

	await loadRDFOxigraph(documentText, oxiStore, mediaType).then((store: Store) => {
		result = store.query(query);
	}).catch((reason) => {
		return [reason];
	}).finally(() => {
		outputChannel.appendLine("Ran query");
	});

	return result;
}



async function getView(documentText: string, mediaType: string, showTypes: boolean): Promise<GVResponse> {
	var store = new Store()
	
	var result:GVResponse = {status: false, message: "initialized", mediaType: "unknown"};
	await loadRDFOxigraph(documentText, store, mediaType).then((store: Store) => {
		const d3graph = buildD3GraphOxi(store, showTypes);
		result = {status: true, message: d3graph, mediaType: ""}; 
	}).catch((reason) => {
		result = {status: false, message: reason, mediaType: ""};
	}).finally(() => {
		outputChannel.appendLine("D3 Graph built");
	});
	return result;
}




async function toSerialization(documentText: string, fromMediaType: string, toMediaType: string): Promise<GVResponse> {
	// var store = $rdf.graph();
	// var serializer = $rdf.Serializer(store);

	// if(fromMediaType == 'application/ld+json' || fromMediaType == 'text/json') {
	// 	suggestContextPrefixes(JSON.parse(documentText), serializer);
	// }
	
	var result:GVResponse = {status: false, message: "initialized", mediaType: "unknown"};
	outputChannel.appendLine("Starting conversion...");

	var oxiStore = new Store();

	await loadRDFOxigraph(documentText, oxiStore, fromMediaType).then((store: Store) => {
		console.log(store);
		return serializeRDFOxigraph(store, toMediaType);
	}).then((data) => {
		result = {status:true, message: data, mediaType: toMediaType};
	}).catch((reason) => {
		result = {status: false, message: reason.toString(), mediaType: ""};
		outputChannel.appendLine(`Failed converting from ${fromMediaType} to ${toMediaType}`);
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


function safeJSIdentifier(value:string) {
	return `id_${value}`.replace(/\W/g, '_').toLowerCase();
}



function buildD3GraphOxi(store: Store, showTypes: boolean): {} {

	const RDF_TYPE: NamedNode = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
	const RDFS_SUBCLASSOF: NamedNode = namedNode("http://www.w3.org/2000/01/rdf-schema#subClassOf")

	var nodesObject: Map<string,Node> = new Map();
	var links: any = [];
	var nodes: Array<Node> = [];


	const statements: Array<Quad> = store.match(null, null, null, null);

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

	function processStatement(s:Quad) {
		let s_qname: string = buildIdOxi(s.subject);
		let p_qname: string = buildIdOxi(s.predicate);
		let o_qname: string = buildIdOxi(s.object);

		let g_qname: string = buildIdOxi(s.graph);

		// Always add the graph as node if it is not the DefaultGraph.
		if (s.graph.termType != "DefaultGraph") {
			let graph = getOrCreateNode(g_qname, g_qname, s.graph.toString(), g_qname, nodesObject);
			// Add the "@graph" type to the types for this node.
			if (!graph.type.includes('@graph')) {
				graph.type.push("@graph");
			}
		}

		if (s.object.termType == "NamedNode" || s.object.termType == "BlankNode") {
			// Get the subject node, or create one if it does not already exist.
			let subject = getOrCreateNode(s_qname, s_qname, s.subject.value, s_qname, nodesObject);
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

			// Skip type triples if showTypes is false
			if (!showTypes && (s.predicate.value == RDF_TYPE.value)) {
				return
			} 
			// Else, we create a node for the object, and add the edge to the graph

			// Get or create the object node; in its own group (not a literal)
			let object = getOrCreateNode(o_qname, o_qname, s.object.value, o_qname, nodesObject);
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
		} else if (s.object.termType == "Literal") {
			// Get the subject, and its attributes
			let subject = getOrCreateNode(s_qname, s_qname, s.subject.value, s_qname, nodesObject);
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

				let object = getOrCreateNode(literal_value_node_id, s.object.value, s.object.value, s_qname, nodesObject);
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

function buildIdOxi(term: NamedNode|BlankNode|DefaultGraphOxi|Literal){

	if (term.termType == "DefaultGraph") {
		return term.value
	} else if (term.termType == 'NamedNode') {
		const iri = term.value
		
		const entry = Object.entries(prefixes).find( ( [key, value] ) => iri.startsWith(value));
		// If the term's IRI starts with one of the known namespace values, replace the namespace part in the name with the prefix
		if (entry != undefined) {
			const [prefix, namespace] = entry;

			return iri.replace(namespace, `${prefix}:`)
		} else {
			return iri
		}
	} else if (term.termType == 'BlankNode') {
		// Return blank nodes as is
		return term.value
	} else if (term.termType == 'Literal') {
		// Return literal values as is too.
		return term.value
	} else {
		throw `${term.termType} is an unknown term type`
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
		outputChannel.appendLine("Hiding nodes and edges for types");
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
			outputChannel.appendLine(result.message);

		}

		
		
	});
}

async function getJSONwithEmbeddedContext(json_document: vscode.TextDocument) {
	const dirname = path.dirname(json_document.uri.fsPath);
	var json_text = json_document.getText();
	var json_object = JSON.parse(json_text);

	let config = vscode.workspace.getConfiguration("linked-data");
	let loadLocalContexts = config.get('loadLocalContexts');
	let prefetchRemoteContexts = config.get('prefetchRemoteContexts');
	let gracefullyIgnoreFailedPrefetch = config.get('gracefullyIgnoreFailedPrefetch');

	if (!(loadLocalContexts || prefetchRemoteContexts) || !json_object['@context']) {
		return(json_object);
	}

	if (loadLocalContexts) {
		outputChannel.appendLine("Will attempt to load any local contexts");
	}
	if (prefetchRemoteContexts) {
		outputChannel.appendLine("Will attempt to prefetch any remote contexts");
		if (gracefullyIgnoreFailedPrefetch) {
			outputChannel.appendLine("Will ignore any failed prefetching of contexts..");
		}
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
				// If the context is a string, and does not start with http, it is likely to be a file.
				// Let's try to load it.
				if (typeof context[c] == 'string' && loadLocalContexts && !context[c].toLowerCase().startsWith("http")) {
					const json_context_path = path.join(dirname, context[c]);
					const json_context_doc = await vscode.workspace.openTextDocument(json_context_path);
					expandedContextArray.push(JSON.parse(json_context_doc.getText()));
					outputChannel.appendLine(`Including context from ${json_context_path}`);
				} else if (typeof context[c] == 'string' && prefetchRemoteContexts && context[c].toLowerCase().startsWith("http") ){
					outputChannel.appendLine("Fetching context from URL: " + context[c]);
					try {
						const response = await axios({
							method: 'get',
							url: context[c],
							headers: { Accept: "application/ld+json;profile=http://www.w3.org/ns/json-ld#context"}
						})

						if(response.headers['content-type'] != 'application/json' && response.headers['content-type'] != 'text/json' && response.headers['content-type'] != 'application/ld+json') {
							throw new Error("Service did not return JSON content type: " + response.headers['content-type']);
						}


						var remote_context = response.data;

						if (typeof remote_context == 'string'){
							// Ensure that the returned response can be parsed as data
							remote_context = JSON.parse(remote_context);
						}

						outputChannel.appendLine("Preloaded context from " + context[c]);
						expandedContextArray.push(remote_context);
					} catch (e: any){
						outputChannel.appendLine("Could not preload context from " + context[c]);
						outputChannel.appendLine(e.message);
						if (!gracefullyIgnoreFailedPrefetch) {
							expandedContextArray.push(context[c]);
						} else {
							outputChannel.appendLine("Continuing regardless of failed preload...")
						}
						
					}
				} else if (typeof context[c] == 'string' && context[c].toLowerCase().startsWith("http") ) {
						// TODO: add ability to inject proxy URL here
						expandedContextArray.push(context[c]);
				} else {
					// Just passing through the value in the context array, as it may be an object or another array.
					expandedContextArray.push(context[c]);
				}
			}
			json_object['@context'] = expandedContextArray;
		}
	} catch (e: any) {
		outputChannel.appendLine(e.message);
		outputChannel.appendLine("Could not load context from files");
	}
	return json_object;
}



// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	console.log('The extension "linked-data" is now active!');

	outputChannel = vscode.window.createOutputChannel("Linked Data Extension");
	outputChannel.show(true);

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
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
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
				const frameJSON = await getJSONwithEmbeddedContext(frameDocument);
				// const frameJSON = JSON.parse(frameDocument.getText());
	
				const framed = await jsonld.frame(documentJSON, frameJSON);
				const framedString = JSON.stringify(framed, null, 2);
				
				let doc = await vscode.workspace.openTextDocument({content: framedString, language: "json"});
				outputChannel.appendLine(`Framed document ${documentName} using ${frameFileURI[0].toString()}`);
				await vscode.window.showTextDocument(doc, {preview: false});
			} catch(e: any) {
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
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
				outputChannel.appendLine(e.message);
			}
			
		}
	});

	let disposableValidator = vscode.commands.registerCommand('linked-data.validate', async () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {

			try {
				let document = editor.document ;

				// Try to obtain YAML configuration from comments at the top of the query 
				const re = /^(#.+\r?\n)+/;
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
						outputChannel.appendLine("Could not parse comments as YAML, or YAML does not define `file` attribute.");
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

				outputChannel.appendLine(`Loading SHACL shapes from ${shaclFileURI}`);
				const shaclDocument = await vscode.workspace.openTextDocument(shaclFileURI);
				const result = await validate(document, shaclDocument);
				
				// No failures? File is valid!
				if(result.failures.length==0) {
					outputChannel.appendLine("Congratulations, your graph is valid!");
					return;
				} 
				// If we do have failures, let's show them.
				outputChannel.appendLine(`Alas, your graph does not conform to the SHACL shapes defined in ${shaclFileURI}`);
				vscode.window.showWarningMessage(`Alas, your graph does not conform to the SHACL shapes defined in ${shaclFileURI}`);

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

				
				let doc = await vscode.workspace.openTextDocument({content: JSON.stringify(result, null, 2), language: "json"});
				await vscode.window.showTextDocument(doc, {preview: false});

				panel.webview.html = html;
				panel.reveal();

				

			} catch(e: any) {
				outputChannel.appendLine(e.message);
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
				const re = /^(#.+\r?\n)+/;
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
						outputChannel.appendLine("Could not parse comments as YAML, or YAML does not define `file` attribute.");
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

				if (result[0] instanceof Quad) {
					// CONSTRUCT query result
					const filteredStore = new Store(result);
					const serializedStore = filteredStore.dump("application/n-quads", undefined);
					
					let doc = await vscode.workspace.openTextDocument({content: serializedStore, language: "turtle"});
					await vscode.window.showTextDocument(doc, {preview: false});
				} else {
					// SELECT query result
					var variables:string[] = [];
					var data = [];

					if (result.length > 0) {
						// First populate the list of variables, otherwise we might miss some.
						for(let r of result) {
							for(let v of r.keys()) {
								if (!variables.includes(v)) {
									variables.push(v);
								}
							}
						}

						for(let r of result){
							console.log(JSON.stringify(r))
							let stringresult = [];
							for(let v of variables){ // variables are key in the map, we hope.
								

								if (r.get(v) != undefined && r.get(v).value != undefined) {
									stringresult.push(r.get(v).value);
								} else {
									stringresult.push("");
								}
								
							}
							data.push(stringresult);
						}
					}

					// Build a CSV file
					let csv:any[] = data;
					// csv.unshift(variables)
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
	${escapeHTML(query)}
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
							pagination: {limit: 50},
							search: true,
							resizable: true
						}).render(document.getElementById("wrapper"));
						</script>
						</body>
					</html>`;
		
					panel.webview.html = html;
					return
				}
			} catch(e: any) {
				outputChannel.appendLine(e.message);
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
		outputChannel.appendLine(`The file is already in the ${toMediaType} format`);
		return;
	} 
	if (fromMediaType == 'application/trig') {
		outputChannel.appendLine(`Unfortunately the TriG format is not supported`);
		return;
	}

	const result = await toSerialization(data, fromMediaType, toMediaType);
	if (result.status) {
		let doc = await vscode.workspace.openTextDocument({ content: result.message, language: targetLanguage });
		await vscode.window.showTextDocument(doc, { preview: false });
	} else {
		outputChannel.appendLine(result.message);
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
		outputChannel.appendLine("Cannot establish file type. Should be json/json-ld, turtle, trig or xml/rdf+xml. N-Triples and N-Quads are automatically derived from Turtle. Make sure you have the Stardog RDF syntaxes extension installed!");
	}
	return { data, fromMediaType };
}


async function validate(document: vscode.TextDocument, shaclDocument: vscode.TextDocument):Promise<any> {
	let doc  = await getDataAndMediaType(document);
	let shapes = await getDataAndMediaType(shaclDocument);
	let store = new Store();
	let shapesStore = new Store();

	outputChannel.appendLine("Loading data file");
	await loadRDFOxigraph(doc.data, store, doc.fromMediaType);
	let data = await serializeRDFOxigraph(store, 'application/ld+json');

	outputChannel.appendLine("Loading SHACL shape file");
	await loadRDFOxigraph(shapes.data, shapesStore, shapes.fromMediaType);
	let shapesData = await serializeRDFOxigraph(shapesStore, 'text/turtle');
	try {
		outputChannel.appendLine("Validating data graph against shapes graph");
		const validator = new ShaclValidator(shapesData, {annotations: {"node": "http://www.w3.org/ns/shacl#focusNode", "label": "http://www.w3.org/2000/01/rdf-schema#label"}});
		let report = await validator.validate(data, {baseUrl: "http://example.org/test"});
		outputChannel.appendLine("Validation completed");
		return(report);
	} catch (e:any) {
		outputChannel.appendLine("SHACL Validator threw an error");
		outputChannel.appendLine(e.message);
		return {failures: [{message: "SHACL Validator threw an error: "+e.message, shape: "N/A", node: "N/A", severity: "error", property: "N/A"}]};
	}
	
  }


function escapeHTML(html:string):string {
    var fn=function(tag:string) {
        var charsToReplace:any = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&#34;'
        };
        return charsToReplace[tag] || tag;
    }
    return html.replace(/[&<>"]/g, fn);
}


// this method is called when your extension is deactivated
export function deactivate() {}


