'use strict';

var t = require('tape');
var migrate = require('../../migrations/v9');

t('migrate interpolated functions', function (t) {
    var input = {
        "version": 8,
        "sources": {
            "vector": {
                "type": "vector",
                "url": "mapbox://mapbox.mapbox-streets-v5"
            }
        },
        "layers": [{
            "id": "functions",
            "type": "symbol",
            "source": "vector",
            "source-layer": "layer",
            "layout": {
                "line-width": {
                    base: 2,
                    stops: [[1, 2], [3, 6]]
                }
            }
        }]
    };

    var output = {
        "version": 9,
        "sources": {
            "vector": {
                "type": "vector",
                "url": "mapbox://mapbox.mapbox-streets-v5"
            }
        },
        "layers": [{
            "id": "functions",
            "type": "symbol",
            "source": "vector",
            "source-layer": "layer",
            "layout": {
                "line-width": {
                    type: 'exponential',
                    base: 2,
                    domain: [1, 3],
                    range: [2, 6]
                }
            }
        }]
    };

    t.deepEqual(migrate(input), output);
    t.end();
});

t('migrate piecewise-constant functions', function (t) {
    var input = {
        "version": 8,
        "sources": {
            "vector": {
                "type": "vector",
                "url": "mapbox://mapbox.mapbox-streets-v5"
            }
        },
        "layers": [{
            "id": "functions",
            "type": "symbol",
            "source": "vector",
            "source-layer": "layer",
            "layout": {
                "text-transform": {
                    stops: [[1, "uppercase"], [3, "lowercase"]],
                }
            }
        }]
    };

    var output = {
        "version":9,
        "sources": {
            "vector": {
                "type": "vector",
                "url": "mapbox://mapbox.mapbox-streets-v5"
            }
        },
        "layers": [{
            "id": "functions",
            "type": "symbol",
            "source": "vector",
            "source-layer": "layer",
            "layout": {
                "text-transform": {
                    type: "interval",
                    domain: [3],
                    range: ["uppercase", "lowercase"],
                }
            }
        }]
    };

    t.deepEqual(migrate(input), output);
    t.end();
});
