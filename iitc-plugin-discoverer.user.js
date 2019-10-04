// ==UserScript==
// @id             iitc-plugin-portal-discoverer@nobody889
// @name           IITC plugin: Portal Discoverer
// @category       Cache
// @version        2.0.5
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @description    [iitc-2017-01-08-021732] discover portals
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// @require        https://cdnjs.cloudflare.com/ajax/libs/rusha/0.8.6/rusha.min.js
// ==/UserScript==
function wrapper(plugin_info) {
    // ensure plugin framework is there, even if iitc is not yet loaded
    if (typeof window.plugin !== 'function') window.plugin = function() {};


    // PLUGIN START ////////////////////////////////////////////////////////

    window.plugin.portalDiscoverer = function() {};
    window.plugin.portalDiscoverer.portalQueue = []; // portals found before we got index
    window.plugin.portalDiscoverer.portalIndex = undefined; // portals we get back from server
    window.plugin.portalDiscoverer.newPortals = {}; // portals we've seen that dont match index

    window.plugin.portalDiscoverer.base_url = undefined;
    window.plugin.portalDiscoverer.how_many_new_portals = 1;
    window.plugin.portalDiscoverer.sending_portal_lock = false;
    window.plugin.portalDiscoverer.discovered_count = 0;
    window.plugin.portalDiscoverer.highlightedPortals = {};

    window.plugin.portalDiscoverer.highlightQueue = [];
    window.plugin.portalDiscoverer.filter_bounds = undefined;

    window.plugin.portalDiscoverer.setup = function() {

        var base_url = localStorage.getItem("base_url");
        if (base_url) {
            window.plugin.portalDiscoverer.base_url = base_url;
            window.plugin.portalDiscoverer.fetchIndex();
        }

        addHook('portalAdded', window.plugin.portalDiscoverer.handlePortalAdded);

        $('head').append('<style>' +
            'iframe { width: "33em"; background: white; border: none; }' +
            'p.stats span { padding: 0 0.5em; }' +
            '</style>');

        $('#toolbox').append('<a onclick="window.plugin.portalDiscoverer.displayLoginDialog()">Discoverer</a>');

        window.addPortalHighlighter('Discovered Portals', window.plugin.portalDiscoverer.highlight);
    };

    window.plugin.portalDiscoverer.highlight = function(data) {
        var latlng = [data.portal._latlng.lat, data.portal._latlng.lng]
        var ll = _llstring(latlng);
        var guid = data.portal.options.guid;

        if (!window.plugin.portalDiscoverer.portalIndex) {
            window.plugin.portalDiscoverer.highlightQueue.push(data);
            return;
        }

        if (window.plugin.portalDiscoverer.filter_bounds &&
            !_point_in_polygon([data.portal._latlng.lng, data.portal._latlng.lat], window.plugin.portalDiscoverer.filter_bounds)) {
//            console.log("discoverer highlight skipping out of bounds", window.plugin.portalDiscoverer.filter_bounds )
            return;
        }

        if (!(guid in window.plugin.portalDiscoverer.portalIndex)) {

            window.plugin.portalDiscoverer.highlightedPortals[guid] = {
                portal: data.portal,
                originalStyle: {
                    fillColor: data.portal.options.fillColor,
                    fillOpacity: data.portal.options.fillOpacity
                }
            };

            data.portal.setStyle({
                fillColor: "red",
                fillOpacity: 1.0
            });
        }
    }



    window.plugin.portalDiscoverer.displayLoginDialog = function() {
        var html = $('<div/>');
        if (window.plugin.portalDiscoverer.base_url) {
            var stats = $('<p class="stats"></p>');
            stats.append($('<span>Index: ' + (window.plugin.portalDiscoverer.portalIndex ? Object.keys(window.plugin.portalDiscoverer.portalIndex).length : "-") + '</span>'));
            stats.append($('<span>Discovered: ' + window.plugin.portalDiscoverer.discovered_count + '</span>'));
            stats.append($('<span>Queued: ' + Object.keys(window.plugin.portalDiscoverer.newPortals).length + '</span>'));

            html.append(stats);
            html.append('<iframe style="width: 33em" src="' + window.plugin.portalDiscoverer.base_url + '"></iframe>');

            html.append($('<button>Clear Server</button>').click(function() {
                window.plugin.portalDiscoverer.base_url = undefined;
                localStorage.removeItem("base_url");
            }));
            html.append($('<button style="margin-left: 1em">Refresh Index</button>').click(function() {
                window.plugin.portalDiscoverer.portalIndex = undefined;
                window.plugin.portalDiscoverer.fetchIndex();
            }));
        } else {
            var server_input = $('<input id="discoverer_server_url" type="text"/>');
            var sbut = $('<button>Save</button>');
            sbut.click(function() {
                var url = server_input.val();
                if (!url.endsWith('/')) {
                    url += '/';
                }
                window.plugin.portalDiscoverer.base_url = url;
                localStorage.setItem("base_url", window.plugin.portalDiscoverer.base_url);

                html.empty();
                html.append('<iframe style="width: 33em" src="' + window.plugin.portalDiscoverer.base_url + '"></iframe>');
            });
            html = $('<div/>');
            html.append(server_input);
            html.append(sbut);
        }

        dialog({
            'html': html,
            'dialogClass': "ui-dialog-discoverer",
            title: "Discoverer",
            id: "discoverer",
            width: "35em"
        });
    };



    window.plugin.portalDiscoverer.handlePortalAdded = function(data) {
        var ll = [data.portal._latlng.lat, data.portal._latlng.lng];


        if (!window.plugin.portalDiscoverer.portalIndex) {
            window.plugin.portalDiscoverer.portalQueue.push(data);
//            console.log("discoverer addPortal pushing to queue")
            return;
        }

        if (window.plugin.portalDiscoverer.filter_bounds &&
            !_point_in_polygon([data.portal._latlng.lng, data.portal._latlng.lat], window.plugin.portalDiscoverer.filter_bounds)) {
//            console.log("discoverer addPortal out of bounds")
            return;
        }

        var name = data.portal.options.data.title;
        var guid = data.portal.options.guid;
        var latE6 = data.portal.options.data.latE6;
        var lngE6 = data.portal.options.data.lngE6;
        var region;
        if (window.plugin.regions) {
            region = window.plugin.regions.regionName(S2.S2Cell.FromLatLng(data.portal._latlng, 6));
        }


//        console.log("discoverer addPortal ", latE6, lngE6, name, guid, region);

        if (!(latE6 && lngE6 && name && guid)) {
            return;
        }

        var doc = {
            latE6: latE6,
            lngE6: lngE6,
            name: name,
            guid: guid,
        };
        if (region) {
            doc.region = region;
        }
        doc._ref = _portal_ref(doc);

        window.plugin.portalDiscoverer.checkInPortal(doc);
    };


    window.plugin.portalDiscoverer.checkInPortal = function(doc) {
        if (doc.guid in window.plugin.portalDiscoverer.newPortals) {
//            console.log("discoverer checkInPortal already in newPortals")
            return;
        }

        if (!(doc.guid in window.plugin.portalDiscoverer.portalIndex)) {
//            console.log("discoverer checkInPortal new portal");
            window.plugin.portalDiscoverer.newPortals[doc.guid] = doc;
        }
        else if (doc._ref != window.plugin.portalDiscoverer.portalIndex[doc.guid]) {
//            console.log("discoverer checkInPortal ref mismatch!", doc, window.plugin.portalDiscoverer.portalIndex[doc.guid])
            window.plugin.portalDiscoverer.newPortals[doc.guid] = doc;
        } else {
//            console.log("discoverer checkInPortal skipping portal");
        }

        window.plugin.portalDiscoverer.sendNewPortals();
    };

    window.plugin.portalDiscoverer.sendNewPortals = function() {
        if (!window.plugin.portalDiscoverer.base_url) {
            return;
        }

        if (window.plugin.portalDiscoverer.sending_portal_lock) {
            return;
        }

        if ((Object.keys(window.plugin.portalDiscoverer.newPortals).length) >= window.plugin.portalDiscoverer.how_many_new_portals) {
            window.plugin.portalDiscoverer.sending_portal_lock = true;

            var how_many_sending = Math.min(100, Object.keys(window.plugin.portalDiscoverer.newPortals).length);

            // var copiedNewPortals = window.plugin.portalDiscoverer.newPortals;
            var guidsSent = Object.keys(window.plugin.portalDiscoverer.newPortals).slice(0, how_many_sending);
            var portalsToSend = {}
            for (var i=0; i < how_many_sending; i++) {
                var guid = guidsSent[i];
                portalsToSend[guid] = window.plugin.portalDiscoverer.newPortals[guid];
                // portalsToSend.push(copiedNewPortals[guidsSent[i]]);
                delete window.plugin.portalDiscoverer.newPortals[guid];
            }
            window.plugin.portalDiscoverer.discovered_count += how_many_sending;
//            console.log("discoverer sending new Portals ", portalsToSend.length)

            _xhr('POST', window.plugin.portalDiscoverer.base_url + "spi", function() {
                window.plugin.portalDiscoverer.sending_portal_lock = false;

                if (Object.keys(window.plugin.portalDiscoverer.newPortals).length > 0) {
                    window.plugin.portalDiscoverer.sendNewPortals();
                }

//                console.log("discoverer highlight spi post callback", guidsSent)
                for (i=0; i < guidsSent.length; i++) {
                    var guid = guidsSent[i];
                    if (guid in window.plugin.portalDiscoverer.highlightedPortals) {
                        var highlightInfo = window.plugin.portalDiscoverer.highlightedPortals[guid];
//                        console.log('discoverer highlightInfo', highlightInfo);
//                        highlightInfo.portal.setStyle(highlightInfo.originalStyle)
                        highlightInfo.portal.setStyle({
                            fillColor: "magenta",
                            fillOpacity: 1.0
                        })
                        delete window.plugin.portalDiscoverer.highlightedPortals[guid];
                    }

                    // var _ref = copiedNewPortals[guid]._ref
//                    console.log("discoverer adding to index", guid, _ref)
                    window.plugin.portalDiscoverer.portalIndex[guid] = portalsToSend[guid];
                }


            }, JSON.stringify(Object.values(portalsToSend)));
        }
    };



    window.plugin.portalDiscoverer.fetchIndex = function() {
        if (window.plugin.portalDiscoverer.base_url) {
            _xhr('GET', window.plugin.portalDiscoverer.base_url + "pidx", window.plugin.portalDiscoverer.handleKnownIndex);
        }
    };

    window.plugin.portalDiscoverer.handleKnownIndex = function(data) {
        if (!window.plugin.portalDiscoverer.portalIndex) {
            window.plugin.portalDiscoverer.portalIndex = {};
        }
        var known;
        if (data.k) {
//            console.log("discoverer new style index", data.r)
            window.plugin.portalDiscoverer.filter_bounds = data.r;
            known = data.k;
        } else {
            known = data;
        }
        var n = Object.keys(known).length;
        for (var guid in known) {
            if (!known.hasOwnProperty(guid)) continue;
            window.plugin.portalDiscoverer.portalIndex[guid] = known[guid];
        }

        window.plugin.portalDiscoverer.processPortalQueue();
    };

    window.plugin.portalDiscoverer.processPortalQueue = function() {
        var i;

        for (i = 0; i < window.plugin.portalDiscoverer.portalQueue.length; i++) {
            window.plugin.portalDiscoverer.handlePortalAdded(window.plugin.portalDiscoverer.portalQueue[i]);
        }
        window.plugin.portalDiscoverer.portalQueue = [];

        for (i = 0; i < window.plugin.portalDiscoverer.highlightQueue.length; i++) {
            window.plugin.portalDiscoverer.highlight(window.plugin.portalDiscoverer.highlightQueue[i]);
        }
        window.plugin.portalDiscoverer.highlightQueue = [];
    };


    // util functions
    var _xhr = function(method, url, cb, data, async) {
        if (async === undefined) async = true;

        var req = new window.XMLHttpRequest();
        req.withCredentials = true;
        req.open(method, url, async);
        req.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        req.onreadystatechange = function() {
            if (req.readyState != 4) return;
            if (req.status == 200) {
                if (this.getResponseHeader('Content-Type') == "application/json") {
                    cb(JSON.parse(req.responseText));
                } else {
                    cb(req.response);
                }
            } else {
            }
        };

        req.send(data);

    };
    var _llstring = function(latlng) {
        return Number(latlng[0]).toFixed(6) + "," + Number(latlng[1]).toFixed(6);
    };
    var _latlng_in_bounds = function(latlng, bounds) {
        return ((latlng[0] <= bounds[0][0] && latlng[0] >= bounds[1][0]) &&
            (latlng[1] >= bounds[0][1] && latlng[1] <= bounds[1][1]));
    };


    var _rusha = new Rusha();
    var _portal_ref = function(doc) {
        return _rusha.digest(doc.latE6+"|"+doc.lngE6+"|"+doc.name+"|"+doc.guid);
    };


    var _point_in_polygon = function (point, vs) {
        // https://github.com/substack/point-in-polygon
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html

        var x = point[0], y = point[1];

        var inside = false;
        for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            var xi = vs[i][0], yi = vs[i][1];
            var xj = vs[j][0], yj = vs[j][1];

            var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    };



    var setup = window.plugin.portalDiscoverer.setup;
    // PLUGIN END //////////////////////////////////////////////////////////

    setup.info = plugin_info; //add the script info data to the function as a property
    if (!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    // if IITC has already booted, immediately run the 'setup' function
    if (window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end


// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = {
    version: GM_info.script.version,
    name: GM_info.script.name,
    description: GM_info.script.description
};
script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
(document.body || document.head || document.documentElement).appendChild(script);