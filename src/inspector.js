// import 'd3';
import * as d3 from "d3";
// import * as d3.tip from 'd3-tip';
import { default as d3tip } from "d3-tip";
import css from './inspector.css';

var DRAW_ARCS = true;

document.addEventListener('DOMContentLoaded', function() {
  const dataElement = window.document.getElementById('data');
  const dataContents = dataElement.innerText;
  const data = JSON.parse(dataContents);

  if (data.links.length > 50) {
    // Too many edges to draw nice arcs with acceptable performance
    DRAW_ARCS = false;
  }

  var sim = init_graph(data);
});


function linkArc(d) {
  var dx = d.target.x - d.source.x,
      dy = d.target.y - d.source.y,
      dr = Math.sqrt(dx * dx + dy * dy);

  // Only return SVG arc path if DRAW_ARCS is true (under 50 edges)
  if (DRAW_ARCS) {
    return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
  } else {
    return "M" + d.source.x + "," + d.source.y + "L" + d.target.x + "," + d.target.y;
  }
}


function init_graph(graph, endpoint, proxy){
  var color = d3.scaleOrdinal(d3.schemePaired);

  function get_color(d){
    if (d.name == 'owl:Ontology' || d.name == 'owl:Class' || d.name == 'sh:NodeShape' || d.name == 'rdfs:Class') {
        return("#000000");
    } else {
        // Unknown type, return default color
        if(d.name.indexOf(':') != -1){
          let prefix = d.name.substring(0,d.name.indexOf(':'));
          return(color(prefix));
        } 
        return("#7545a4");
    }
  }

  const reducer = (accumulator, current) => `${accumulator}<tr><th><span style="color: ${color(current.property)}">${current.property}</span></th><td>"${current.value}"</td>`;

  //add tool tip
  var tip = d3tip()
    .attr('class', 'd3-tip')
    .offset([-10, 0])
    .html(function(d) {
      const sorted_attributes = d.attributes.sort((a, b) => a.property.localeCompare(b.property));

      var typerow = '';
      if(d.type.length > 0 ){
        typerow = `<tr><th>@type</th><td>${d.type}</td></tr>`;
      }
      return `<strong>${d.uri}</strong><br/><table>${typerow}${sorted_attributes.reduce(reducer,"")}</table>`;

    });

  var svg = d3.select("svg");

  
  var width = window.document.getElementsByTagName('svg')[0].clientWidth;
  var height = window.document.getElementsByTagName('svg')[0].clientHeight;

  svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
    .append("svg:path")
      .attr("d", "M0,-5L10,0L0,5");



  svg.call(tip);

  var simulation = d3.forceSimulation()
      .force("link", d3.forceLink().id(function(d) { return d.id; }))
      .force("charge", d3.forceManyBody()
          .strength(-1500))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .alpha(0.1);

  //add encompassing group for the zoom
  var g = svg.append("g")
      .attr("class", "everything");

  var linkg = g.append("g")
      .attr("class", "links");

  var link = linkg.selectAll(".edgearc")
      .data(graph.links)
      .enter().append("path")
        .attr("stroke-width", function(d) { return Math.sqrt(d.value); })
        .attr('fill-opacity', 0)
        .attr('stroke-opacity', 100)
        .attr("marker-end", "url(#arrow)");

//  link.append("title")
//              .text(function (d) {return d.name;});

  var edgepaths = linkg.selectAll(".edgepath")
      .data(graph.links)
      .enter()
      .append('path')
      .attr('class','edgepath')
      .attr('fill-opacity', 0)
      .attr('stroke-opacity', 0)
      .attr('id', function (d, i) {return 'edgepath' + i;})
      .style("pointer-events", "none");
  
  var edgelabels = linkg.selectAll(".edgelabel")
      .data(graph.links)
      .enter()
      .append('text')
      .style("pointer-events", "none")
      .attr('class', 'edgelabel')
      .attr('id', function (d, i) {return 'edgelabel' + i;})
      .attr('font-size', 8)
      .attr('fill', '#aaa');


  edgelabels.append('textPath')
      .attr('xlink:href', function (d, i) {return '#edgepath' + i;})
      .style("text-anchor", "middle")
      .style("pointer-events", "none")
      .attr("startOffset", "50%")
      .text(function (d) {return d.name;});





    var node = g.append("g")
        .attr("class", "nodes")
      .selectAll("g")
      .data(graph.nodes)
      .enter().append("g");

    var circles = node.append("circle")
        .attr("r", 10)
        .attr("fill", function(d) {
          return get_color(d);
        })
        .on('mouseover', tip.show)
        .on('mouseout', tip.hide)
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    var labels = node.append("text")
        .text(function(d) {
          if('rdfs:label' in d) {
            return d['rdfs:label'];
          } else if(d.name == '[]') {
            // Don't return anything for blank nodes.
            return '';
          } else {
            return d.name.replace('&lt;','<').replace('&gt;','>');
          }
        })
        .attr('x', 11)
        .attr('y', 4);

//    var edge_labels = link.append("text")
//        .text(function(d) { return d.name; })
//        .attr('x', 6)
//        .attr('y', 3);

    node.append("title")
        .text(function(d) { return d.id; });

    simulation
        .nodes(graph.nodes)
        .on("tick", ticked);

    simulation.force("link")
        .links(graph.links);

    //add zoom capabilities
    var zoom_handler = d3.zoom()
          .on("zoom", zoom_actions);

    zoom_handler(svg);

    //Zoom functions
    function zoom_actions(){
        g.attr("transform", d3.event.transform);
    }

    function ticked() {


      link
          .attr("x1", function(d) { return d.source.x; })
          .attr("y1", function(d) { return d.source.y; })
          .attr("x2", function(d) { return d.target.x; })
          .attr("y2", function(d) { return d.target.y; });

      link.attr("d", linkArc);

      node
          .attr("transform", function(d) {
            return "translate(" + d.x + "," + d.y + ")";
          });

      edgepaths.attr("d", linkArc);


    }



  function dragstarted(d) {
    if (!d3.event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }

  function dragended(d) {
    if (!d3.event.active) simulation.alphaTarget(0);
    // d.fx = null;
    // d.fy = null;
  }

  return simulation;
}
