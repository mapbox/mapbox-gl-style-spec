'use strict';

var t = require('tape'),
    diffStyles = require('../lib/diff');

t('diff', function (t) {

    t.deepEqual(diffStyles({
        layers: [{ id: 'a' }]
    }, {
        layers: [{ id: 'a' }]
    }), [], 'no changes');

    t.deepEqual(diffStyles({
        version: 7,
        layers: [{ id: 'a' }]
    }, {
        version: 8,
        layers: [{ id: 'a' }]
    }), [
      { command: 'setStyle', args: [{ version: 8, layers: [{ id: 'a' }] }] }
    ], 'version change');


    t.deepEqual(diffStyles({
        layers: [{ id: 'a' }]
    }, {
        layers: [{ id: 'a' }, { id: 'b' }]
    }), [
        { command: 'addLayer', args: [{ id: 'b' }, undefined] }
    ], 'add a layer');

    t.deepEqual(diffStyles({
        layers: [{ id: 'b' }]
    }, {
        layers: [{ id: 'a' }, { id: 'b' }]
    }), [
        { command: 'addLayer', args: [{ id: 'a' }, 'b'] }
    ], 'add a layer before another');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a' }, { id: 'b', source: 'foo', nested: [1] }]
    }, {
        layers: [{ id: 'a' }]
    }), [
        { command: 'removeLayer', args: ['b'] }
    ], 'remove a layer');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a' }, { id: 'b' }]
    }, {
        layers: [{ id: 'b' }, { id: 'a' }]
    }), [
      { command: 'removeLayer', args: ['a'] },
      { command: 'addLayer', args: [{ id: 'a' }, undefined] }
    ], 'move a layer');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', paint: { foo: 1 } }]
    }, {
        layers: [{ id: 'a', paint: { foo: 2 } }]
    }), [
        { command: 'setPaintProperty', args: ['a', 'foo', 2, null] }
    ], 'update paint property');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', 'paint.light': { foo: 1 } }]
    }, {
        layers: [{ id: 'a', 'paint.light': { foo: 2 } }]
    }), [
        { command: 'setPaintProperty', args: ['a', 'foo', 2, 'light'] }
    ], 'update paint property class');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', paint: { foo: { ramp: [1, 2] } } }]
    }, {
        layers: [{ id: 'a', paint: { foo: { ramp: [1] } } }]
    }), [
        { command: 'setPaintProperty', args: ['a', 'foo', { ramp: [1] }, null] }
    ], 'nested style change');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', layout: { foo: 1 } }]
    }, {
        layers: [{ id: 'a', layout: { foo: 2 } }]
    }), [
        { command: 'setLayoutProperty', args: ['a', 'foo', 2, null] }
    ], 'update layout property');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', filter: ['==', 'foo', 'bar'] }]
    }, {
        layers: [{ id: 'a', filter: ['==', 'foo', 'baz'] }]
    }), [
        { command: 'setFilter', args: ['a', [ '==', 'foo', 'baz' ] ] }
    ], 'update a filter');

    t.deepEqual(diffStyles({
        sources: { foo: 1 }
    }, {
        sources: {}
    }), [
        { command: 'removeSource', args: ['foo'] }
    ], 'remove a source');

    t.deepEqual(diffStyles({
        sources: {}
    }, {
        sources: { foo: 1 }
    }), [
        { command: 'addSource', args: ['foo', 1] }
    ], 'add a source');

    t.deepEqual(diffStyles({}, {
        metadata: { 'mapbox:author': 'nobody' }
    }), [], 'ignore style metadata');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', metadata: { 'mapbox:group': 'Group Name' } }]
    }, {
        layers: [{ id: 'a', metadata: { 'mapbox:group': 'Another Name' } }]
    }), [], 'ignore layer metadata');

    t.deepEqual(diffStyles({
        center: [0, 0]
    }, {
        center: [1, 1]
    }), [
      { command: 'setCenter', args: [[1, 1]] }
    ], 'center change');

    t.deepEqual(diffStyles({
        zoom: 12
    }, {
        zoom: 15
    }), [
      { command: 'setZoom', args: [15] }
    ], 'zoom change');

    t.deepEqual(diffStyles({
        bearing: 0
    }, {
        bearing: 180
    }), [
      { command: 'setBearing', args: [180] }
    ], 'bearing change');

    t.deepEqual(diffStyles({
        pitch: 0
    }, {
        pitch: 1
    }), [
      { command: 'setPitch', args: [1] }
    ], 'pitch change');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', }, {id: 'b'}, {id: 'c', ref: 'b'}]
    }, {
        layers: [{ id: 'a'}]
    }), [
      { command: 'removeLayer', args: ['b'] }
    ], 'remove referenced layers');

    t.deepEqual(diffStyles({
        layers: [{ id: 'a', }, {id: 'b'}, {id: 'c', ref: 'b'}]
    }, {
        layers: [{id: 'a'}, {id: 'b'}]
    }), [
      { command: 'removeLayer', args: ['c'] }
    ], 'remove layers that reference other layers');

    t.end();
});
