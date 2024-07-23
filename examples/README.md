The examples in this folder are:

* [`shacl_example.ttl`](shacl_example.ttl) is a sample Turtle file for testing SHACL constraints.
* [`shacl_example_shapes.ttl`](shacl_example_shapes.ttl) holds SHACL constraints for validating [`shacl_example.ttl`](shacl_example.ttl). Note that the [`shacl_example.ttl`](shacl_example.ttl) file refers to this shapes file. This is not required, but avoids having to select the shapes file from a file open window.
* [`shacl_example.rq`](shacl_example.rq) is a very simple SPARQL query to query the [`shacl_example.ttl`](shacl_example.ttl) file. Note that the SPARQL query refers to the file it is intended to query. This is not required, but avoids having to select the data file from a file open window.
* [`test.jsonld`](test.jsonld) is an example JSON-LD file that can be used for testing format conversion and JSON-LD manipulation.
* [`test_frame.jsonld`](test_frame.jsonld) is an example JSON-LD frame for framing the [`test.jsonld`](test.jsonld) file.
* [`list.ttl`](list.ttl) is a simple Turtle file that contains an `rdf:List` construct.