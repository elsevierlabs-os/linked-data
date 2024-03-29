import * as d3 from "d3";
import { default as d3tip } from "d3-tip";
// import { on } from "events";

document.addEventListener('DOMContentLoaded', function() {
    const dataContents = window.document.getElementById('data').innerText;
    const data = JSON.parse(dataContents);

    
    var width = window.document.getElementsByTagName('svg')[0].clientWidth ;
    var height = window.document.getElementsByTagName('svg')[0].clientHeight ;
    
    ForceGraph(data, {
        nodeTitle: d => d.id,
        linkStrokeWidth: l => Math.sqrt(l.value),
        // nodeRadius: d => Math.log(150 * (1 + 2 * ((d.attributes || []).length))), // Node size is determined by the number of attributes with a minimum radius of ~5.
        nodeRadius: d => (20-Math.pow(((d.attributes || []).length + 13)/50,-2)),
        width,
        height
        // ,
        // invalidation // a promise to stop the simulation when the cell is re-run
      });
    
    //   window.document.body.appendChild(svg);
});



// Tool tips
var tip = d3tip()
  .attr('class', 'd3-tip')
  .offset([-10, 0])
  .html();

function ForceGraph({nodes, links}, // a dictionary with nodes and links arrays.
{
    nodeId = d => d.id, // given d in nodes, returns a unique identifier (string)
    nodeName = d => d.name, // given d in links, returns a name for the link
    nodeGroup = d => d.group, // given d in nodes, returns an (ordinal) value for color
    nodeGroups, // an array of ordinal values representing the node groups
    nodeTitle, // given d in nodes, a title string
    nodeType = d => d.type, // given d in nodes, the type array
    nodeAttributes = d => d.attributes, // given d in links, returns a name for the link
    nodeTypes, // an array of ordinal values representing the node types
    nodeFill = "currentColor", // node stroke fill (if not using a group color encoding)
    nodeStroke = "#fff", // node stroke color
    nodeStrokeWidth = 1.5, // node stroke width, in pixels
    nodeStrokeOpacity = 1, // node stroke opacity
    nodeRadius = d => 5, // node radius, in pixels
    nodeStrength = -1000,
    linkId = d => d.id, // given d in links, returns a link identifier string
    linkName = d => d.name, // given d in links, returns a name for the link
    linkSource = ({ source }) => source, // given d in links, returns a node identifier string
    linkTarget = ({ target }) => target, // given d in links, returns a node identifier string
    linkGraph = d => d.graph, // given d in links, returns the subgraph it belongs to.
    linkStroke = "#999", // link stroke color
    linkStrokeOpacity = 0.6, // link stroke opacity
    linkStrokeWidth = 1.5, // given d in links, returns a stroke width in pixels
    linkStrokeLinecap = "round", // link stroke linecap
    linkFontSize = "8",
    linkStrength = 1,
    colors = d3.schemeTableau10, // an array of color strings, for the node groups
    width = 640, // outer width, in pixels
    height = 400, // outer height, in pixels
    invalidation // when this promise resolves, stop the simulation
} = {}) {
    // The SVG element
    const svg = d3.select("svg");

    const STAR = "M14.615,4.928c0.487-0.986,1.284-0.986,1.771,0l2.249,4.554c0.486,0.986,1.775,1.923,2.864,2.081l5.024,0.73c1.089,0.158,1.335,0.916,0.547,1.684l-3.636,3.544c-0.788,0.769-1.28,2.283-1.095,3.368l0.859,5.004c0.186,1.085-0.459,1.553-1.433,1.041l-4.495-2.363c-0.974-0.512-2.567-0.512-3.541,0l-4.495,2.363c-0.974,0.512-1.618,0.044-1.432-1.041l0.858-5.004c0.186-1.085-0.307-2.6-1.094-3.368L3.93,13.977c-0.788-0.768-0.542-1.525,0.547-1.684l5.026-0.73c1.088-0.158,2.377-1.095,2.864-2.081L14.615,4.928z";


    // The force directed simulation
    var simulation;
    
    // Canvases (these will be continuously updated)
    var hull, link, node, nodetext;
    // Nodes that should be collapsed
    var expand = {}; // collapsable attribute clusters
    // The visible nodes and links (to preserve positions)
    var visible_nodes = [], visible_links = [];

    // A g that groups the links and the nodes so that we can apply a single zoom function.
    const zoom = svg.append("g");

    // A g that holds the hull (area) for a (named) graph
    var hull_G = zoom.append("g");
    // This is the g that holds the links
    var link_G = zoom.append("g")
        .attr("stroke", typeof linkStroke !== "function" ? linkStroke : null)
        .attr("stroke-opacity", linkStrokeOpacity)
        .attr("stroke-width", typeof linkStrokeWidth !== "function" ? linkStrokeWidth : null)
        .attr("stroke-linecap", linkStrokeLinecap);
    // This is the g that holds the nodes
    var node_G = zoom.append("g") 
        .attr("fill", nodeFill)
        .attr("stroke", nodeStroke)
        .attr("stroke-opacity", nodeStrokeOpacity)
        .attr("stroke-width", nodeStrokeWidth);
    

    // Setup zoom and canvas-dragging functionality
    svg.call(d3.zoom()
        .extent([[0,0],[width, height]])
        // .scaleExtent([1,8])
        .on("zoom", zoomed));
    
    // Definitions: add a marker
    svg.append("defs").append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 19)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .attr("stroke", typeof linkStroke !== "function" ? linkStroke : null)
        .attr("stroke-opacity", linkStrokeOpacity)
        .attr("stroke-width", typeof linkStrokeWidth !== "function" ? linkStrokeWidth : null)
        .attr("stroke-linecap", linkStrokeLinecap)
        .attr("fill", typeof linkStroke !== "function" ? linkStroke : null)
        .append("path")
            .attr("d", "M0,-5L10,0L0,5");


    // Tool tips
    const Tooltip = d3.select("div#tooltip")
            .style("opacity", 0)
            .attr("class","tooltip")
            .style("background-color", "white")
            .style("border", "solid")
            .style("border-width", "2px")
            .style("border-radius", "5px")
            .style("padding", "5px")
            .style("position", "absolute")
            .style("z-index", 1000);



    // By default none of the nodes should be expanded
    expand = {};

    // Construct the forces.
    const forceNode = d3.forceManyBody();
    if (nodeStrength !== undefined) forceNode.strength(nodeStrength);
    const forceX = d3.forceX(width / 2).strength(0.4);
    const forceY = d3.forceY(height / 2).strength(0.4);

    simulation = d3.forceSimulation()
        .force("charge", forceNode)
        .force("center", d3.forceCenter(width / 2, height / 2).strength(0.5))
        // .force("x", forceX)
        // .force("y", forceY)
        .force("collision", d3.forceCollide().radius(9))
        .alpha(1)
        .alphaDecay(0.03)
        .velocityDecay(0.9)
        .on("tick", ticked);

    update();
    simulation.alpha(1).restart();

    function update() {
        if (simulation) {
            console.log("Simulation stopped");
            simulation.stop();
        }
        var nodes_object = nodes.reduce(
            (obj, item) => Object.assign(obj, { [item.id]: item }), {});

        var previously_visible_nodes_object = visible_nodes.reduce(
            (obj, item) => Object.assign(obj, { [item.id]: item }), {});

        // Filter nodes and links to determine whether they should be visible or not.
        // This preserves positions in case the node object was already visible
        visible_nodes = [];
        for(let node of nodes) {
            if (expand[node.group]) {
                if (previously_visible_nodes_object[node.id]) {
                    visible_nodes.push(previously_visible_nodes_object[node.id]);
                } else {
                    // Initialize new child nodes to the position of the group node.
                    // The group node is always visible, but the previously visible nodes object may not have been fully initialized.
                    // let group_node;
                    // if (previously_visible_nodes_object[node.group]) {
                    //     group_node = previously_visible_nodes_object[node.group];
                    // } else {
                    //     group_node = nodes_object[node.group];
                    // }
                    let group_node = previously_visible_nodes_object[node.group] ? previously_visible_nodes_object[node.group] : nodes_object[node.group];
                    
                    console.log(group_node);
                    node.x = group_node.x+10;
                    node.y = group_node.y+10;
                    console.log(node.x);
                    console.log(node.y);

                    visible_nodes.push(node);
                }
            } else if (node.group == node.id) {
                visible_nodes.push(previously_visible_nodes_object[node.id] ? previously_visible_nodes_object[node.id] : nodes_object[node.id]);
            }
        }

        // visible_nodes = d3.filter(nodes, node => (expand[node.group] || node.group == node.id));
        
        visible_links = d3.filter(links, link => 
            (expand[nodes_object[link.source].group] || nodes_object[link.source].group == link.source) &&
            (expand[nodes_object[link.target].group] || nodes_object[link.target].group == link.target)
        );

        // Compute values.
        const N = d3.map(visible_nodes, nodeId).map(intern);
        const Na = d3.map(visible_nodes, nodeName).map(intern);
        const Nat = d3.map(visible_nodes, nodeAttributes).map(intern);
        const Ty = nodeType == null ? null : d3.map(visible_nodes, nodeType).map(intern);
        const G = nodeGroup == null ? null : d3.map(visible_nodes, nodeGroup).map(intern);
        const LS = d3.map(visible_links, linkSource).map(intern);
        const LT = d3.map(visible_links, linkTarget).map(intern);
        const LG = d3.map(visible_links, linkGraph).map(intern);
        const Li = d3.map(visible_links, linkId).map(intern);
        const Ln = d3.map(visible_links, linkName).map(intern);

        // Fix nodes regardless
        // const Fx = d3.map(visible_nodes, d => d.fx ? d.fx : d.x );
        // const Fy = d3.map(visible_nodes, d => d.fy ? d.fy : d.y );
        // Only fix fixed nodes :-)
        const Fx = d3.map(visible_nodes, d => d.fx );
        const Fy = d3.map(visible_nodes, d => d.fy );

        const X = d3.map(visible_nodes, d => d.x );
        const Y = d3.map(visible_nodes, d => d.y );
        

        function intern(value) {
            return value !== null && typeof value === "object" ? value.valueOf() : value;
        }

        // Replace the input nodes and links with mutable objects for the simulation.
        visible_nodes = d3.map(visible_nodes, (_, i) => ({ id: N[i], name: Na[i], group: G[i], type: Ty[i], attributes: Nat[i], fx: Fx[i], fy: Fy[i], x: X[i], y: Y[i]}));
        visible_links = d3.map(visible_links, (_, i) => ({ id: Li[i], source: LS[i], target: LT[i], graph: LG[i], name: Ln[i]}));

        if (nodeTitle === undefined) nodeTitle = (_, i) => N[i];
        const T = nodeTitle == null ? null : d3.map(visible_nodes, nodeTitle);
        const W = typeof linkStrokeWidth !== "function" ? null : d3.map(visible_links, linkStrokeWidth);
        const L = typeof linkStroke !== "function" ? null : d3.map(visible_links, linkStroke);
        
        

        // Compute default domains / groups.
        if (G && nodeGroups === undefined) nodeGroups = d3.sort(G);
        // Construct the scales.
        const groupColor = nodeGroup == null ? null : d3.scaleOrdinal(nodeGroups, colors);

        // Compute default domains / types.
        if (Ty && nodeTypes == undefined) nodeTypes = d3.sort(Ty);
        // Construct the scales
        const typeColor = nodeType == null ? null : d3.scaleOrdinal(nodeTypes, colors);

        // Compute more forces
        const forceLink = d3.forceLink(visible_links).distance(linkDistance).id(({ index: i }) => N[i]);
        if (linkStrength !== undefined) forceLink.strength(linkStrength);

        // Stay close if two nodes are in the same group (i.e. one is an attribute of the other)
        function linkDistance(d) {
            if(d.source.group == d.target.group) {
                return 20;
            } else {
                return 100;
            }
        }

        // Set the visible nodes and links
        simulation.nodes(visible_nodes).force("link", forceLink);

        /*
         * Create shapes for each graph
         */
        hull_G.selectAll("path.hull").remove();
        hull = hull_G.selectAll("path.hull")
            .data(computeGraphHulls(visible_links, visible_nodes))
            .enter()
            .append("path")
            .attr("class", "hull")
            .attr("d", drawHull)
            .style("fill", "lightsteelblue")
            .style("fill-opacity", 0.3)
            .on("mouseover", mouseover)
            .on("mousemove", mousemove)
            .on("mouseleave", mouseleave);

        /*
         * Create the nodes
         */
        node = node_G.selectAll("circle")
            .data(visible_nodes, d => d.id)
            .join("circle")
            .attr("r", nodeRadius)
            .call(drag(simulation))
            .on("click", click)
            .on("dblclick", doubleclick)
            .on("mouseover", mouseover)
            .on("mousemove", mousemove)
            .on("mouseleave", mouseleave);

        node.append("title").text(d => d.id);

        /*
         * Create the links
         */
        link = link_G.selectAll("path")
            .data(visible_links, d => d.id)
            .join('path')
                .attr("marker-end", "url(#arrow)")
                .attr('id', d => d.id);

        var edge_labels = link_G.selectAll("link")
            .data(visible_links, d => d.id)
            .join('text')
                .style("pointer-events", "none");

        edge_labels.append('textPath')
            .attr('xlink:href', d => `#${d.id}`)
            .style("text-anchor", "middle")
            .style("pointer-events", "none")
            .attr("startOffset", "50%")
            .text(function (d) {return d.name;});

        if(linkFontSize != undefined) edge_labels.attr('font-size', linkFontSize);

        if (W) link.attr("stroke-width", ({ index: i }) => W[i]);
        if (L) link.attr("stroke", ({ index: i }) => L[i]);
        // Fill colors of nodes are determined by the group
        if (G) node.attr("fill", ({ index: i }) => groupColor(G[i]));
        // if (G) node.attr("stroke", ({ index: i }) => groupColor(G[i]));
        // if (Ty) node.attr("fill", ({ index: i }) => typeColor(Ty[i]));
        // if (T) node.append("title").text(({ index: i }) => T[i]);
        if (Ty) node.attr("stroke", ({ index: i}) => Ty[i][0] == "Literal" ? "black" : "white");

        if (invalidation != null) invalidation.then(() => simulation.stop());

        return Object.assign(svg.node(), { scales: { color: groupColor } });
    }
    

     /**
     * Event handlers
     */
    function click(event, d) {
        // Flip "expanded" flag.
        if(d.attributes.length > 0 || expand[d.group]){
            expand[d.group] = !expand[d.group];
            update();
            simulation.alpha(0.3).restart();
        }
    }

    function doubleclick(event, d) {
        event.stopPropagation();
        // Remove fixed position
        delete d.fx;
        delete d.fy;
    }

    // Show the tooltip
    function mouseover(event, d) {
        Tooltip
            .html(tooltipHTML(d))
            .transition().duration(200)
            .style("opacity", 0.9);
    }

    // Add content to the tooltip
    function mousemove(event, d) {
        Tooltip
            .style("left", (event.pageX + 20) + "px")
            .style("top", (event.pageY) + "px");
    }

    // And hide the tooltip
    function mouseleave(event, d) {
        Tooltip.transition().duration(200).style("opacity", 0);
    }


    /**
     * Simulation ticks
     */
    function ticked() {
        if (!hull.empty()) {
            hull.data(computeGraphHulls(visible_links, visible_nodes))
                .attr("d", drawHull);
        }

        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y)
            .attr("d", d => `M${d.source.x},${d.source.y}L${d.target.x},${d.target.y}`);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
    }

    const reducer = (accumulator, current) => `${accumulator}<tr><th><span>${current.property}</span></th><td>"${current.value}"</td>`;

    function tooltipHTML(d) {

        if (d.attributes != undefined) {
            const sorted_attributes = d.attributes.sort((a, b) => a.property.localeCompare(b.property));

            var typerow = '';
            if(d.type.length > 0 ){
              typerow = `<tr><th>@type</th><td>${d.type}</td></tr>`;
            }
            return `<strong>${d.name}</strong><br/><table>${typerow}${sorted_attributes.reduce(reducer,"")}</table>`;
        } else {
            return `<strong>${d.graph}</strong>`;
        }
    }

    function computeGraphHulls(links, nodes){
        let offset = 15; // default offset
        // A dictionary that holds points per graph
        var hulls = {};
        // An array of 
        var hullset = [];

        for (var k = 0; k < links.length; ++k) {
            let link = links[k];
            // if (link.size) continue;
        
            // Get the graph identifier for this link
            let graph = link.graph;

            // Skip the default graph.
            if (graph == "DefaultGraph") continue;

            // Get or create the array of points around the links
            var l = hulls[graph] || (hulls[graph] = []);
        
            l.push([link.source.x - offset, link.source.y - offset]);
            l.push([link.source.x - offset, link.source.y + offset]);
            l.push([link.source.x + offset, link.source.y - offset]);
            l.push([link.source.x + offset, link.source.y + offset]);
        
            l.push([link.target.x - offset, link.target.y - offset]);
            l.push([link.target.x - offset, link.target.y + offset]);
            l.push([link.target.x + offset, link.target.y - offset]);
            l.push([link.target.x + offset, link.target.y + offset]);
        }

        // Create convex hulls from the arrays of points
        for (let g in hulls) {
            let points = hulls[g];

            let graph = nodes.find(x => x.id == g);

            if (graph!= undefined) {
                points.push([graph.x - offset, graph.y - offset]);
                points.push([graph.x - offset, graph.y + offset]);
                points.push([graph.x + offset, graph.y - offset]);
                points.push([graph.x + offset, graph.y + offset]);
            } else {
                // do nothing (probably the default graph)
            }

            hullset.push({ graph: g, path: d3.polygonHull(points) });
        }

        return hullset;
    }

    function drawHull(d) {
        var line = d3.line().curve(d3.curveCardinalClosed.tension(0.85));
        return line(d.path);
    }

    function drag(simulation) {
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = clamp(event.x, 0, width);
            event.subject.fy = clamp(event.y, 0, height);
            simulation.alpha(1).restart();
        }

        function clamp(x, lo, hi) {
            return x < lo ? lo : x > hi ? hi : x;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            // Uncomment this if you want to snap the node back into the force calculation (non-fixed position)
            // event.subject.fx = null;
            // event.subject.fy = null;
        }

        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }

    function zoomed({transform}) {
        zoom.attr("transform", transform);
    }

    
}