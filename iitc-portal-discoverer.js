// ==UserScript==
// @id             iitc-plugin-portal-discoverer@noobdy889
// @name           IITC plugin: Portal Discoverer
// @category       Cache
// @version        0.0.2
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
// ==/UserScript==


function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};


// PLUGIN START ////////////////////////////////////////////////////////


// util functions
var _xhr = function(method, url, cb, data, async) {
  if (async === undefined) async = true;

  var req = new window.XMLHttpRequest();
  req.withCredentials = true;
  req.open(method, url, async);
  req.setRequestHeader("Content-Type", "application/json;charset=UTF-8")
  req.onreadystatechange = function() {
    // console.log("discoverer xhr readystatechange", req)
    if (req.readyState != 4) return;
    if(req.status == 200) {
      cb(JSON.parse(req.responseText));
    }
  };

  req.send(data);

};
var _llstring = function(latlng) {
  return latlng[0]+","+latlng[1];
};


// use own namespace for plugin
window.plugin.portalDiscoverer = function() {};
window.plugin.portalDiscoverer.portalQueue = [];
window.plugin.portalDiscoverer.portalIndex = null;
window.plugin.portalDiscoverer.newPortals = {};

window.plugin.portalDiscoverer.base_url = "https://28fcf9fc.ngrok.io/";
window.plugin.portalDiscoverer.how_many_new_portals = 1;


window.plugin.portalDiscoverer.filter_bounds = [
  [46.325171, -124.799138]
  [41.991194, -117.023564]
]

window.plugin.portalDiscoverer.setup  = function() {

  var portal_cache = localStorage.getItem("known_portal_index");
  if (portal_cache) {
    window.plugin.portalDiscoverer.portalIndex = JSON.parse(portal_cache)
    console.log("discoverer found existing index", window.plugin.portalDiscoverer.portalIndex.length)
  } else {
    console.log("discoverer has no index, fetching")
    // var index_url = "https://rocky-coast-43626.herokuapp.com/pidx";
    // var index_url = "https://28fcf9fc.ngrok.io/pidx";
    _xhr('GET', window.plugin.portalDiscoverer.base_url+"pidx", window.plugin.portalDiscoverer.handleKnownIndex);
  }

  addHook('portalAdded', window.plugin.portalDiscoverer.handlePortalAdded);


  $('#toolbox').append('<a onclick="window.plugin.portalDiscoverer.displayLoginDialog()">Discoverer</a>')
};


window.plugin.portalDiscoverer.displayLoginDialog = function() {
  var html = '<iframe src="https://rocky-coast-43626.herokuapp.com/pidx"></iframe>';

  dialog({
    'html': html,
    'dialogClass': "ui-dialog-discoverer",
    title: "Discoverer",
    id: "discoverer",
    width: 700
  });
}


window.plugin.portalDiscoverer.handlePortalAdded = function(data) {

  var latlng = [data.portal._latlng.lat, data.portal._latlng.lng];
  var name = data.portal.options.data.title;
  var idx = {
    latlng: latlng,
    name: name
  };
  var llstring = _llstring(latlng);

  // console.log("discoverer portalAdded", data, idx, llstring);
  if (!name) {
    return; // skip unless we know the name
  }

  if (window.plugin.portalDiscoverer.portalIndex) {
    window.plugin.portalDiscoverer.checkInPortal(llstring, idx)
  } else {
    console.log("discoverer queueing portal", llstring);
    window.plugin.portalDiscoverer.portalQueue.push([llstring,idx]);
  }

};

window.plugin.portalDiscoverer.checkInPortal = function(llstring, idx) {
  if (!window.plugin.portalDiscoverer.portalIndex) 
    return;
  console.log("discoverer checking in portal", llstring, idx, window.plugin.portalDiscoverer.portalIndex[llstring])

  if (!(llstring in window.plugin.portalDiscoverer.portalIndex)) {
    if (!(llstring in window.plugin.portalDiscoverer.newPortals)) {
      console.log("discoverer adding to newPortals!");
      window.plugin.portalDiscoverer.newPortals[llstring] = idx;
    } else {
      console.log("discoverer already found this new portal");
      window.plugin.portalDiscoverer.newPortals[llstring].name = idx.name;
    }
  } 

  window.plugin.portalDiscoverer.sendNewPortals();
};

window.plugin.portalDiscoverer.sendNewPortals = function() {
  if ((Object.keys(window.plugin.portalDiscoverer.newPortals).length) > window.plugin.portalDiscoverer.how_many_new_portals) {
    var portalsToSend = Object.values(window.plugin.portalDiscoverer.newPortals)
    window.plugin.portalDiscoverer.newPortals = {}
    console.log("discoverer posting new portals ", portalsToSend)
    _xhr('POST', window.plugin.portalDiscoverer.base_url+"spi", window.plugin.portalDiscoverer.handleSubmit, JSON.stringify(portalsToSend));
  } else {
    console.log("discoverer skipping sendNewPortals, not enough new")
  }
}


window.plugin.portalDiscoverer.handleKnownIndex = function(data) {
  console.log("discoverer index data", data.k.length);
  window.plugin.portalDiscoverer.portalIndex = {};
  for (var i =0; i < data.k.length; i++) {
    var ll = [data.k[i][1], data.k[i][0]];
    var key = _llstring(ll);
    window.plugin.portalDiscoverer.portalIndex[key] = true;
  }

  console.log("discoverer saving index to localStorage")
  localStorage.setItem("known_portal_index", JSON.stringify(window.plugin.portalDiscoverer.portalIndex))

  console.log("discoverer handle portalQueue", window.plugin.portalDiscoverer.portalQueue.length);
  for (var i=0; i < window.plugin.portalDiscoverer.portalQueue.length; i++) {
    var llstring = window.plugin.portalDiscoverer.portalQueue[i][0];
    var idx = window.plugin.portalDiscoverer.portalQueue[i][1];
    window.plugin.portalDiscoverer.checkInPortal(llstring, idx);
  }

};







var setup = window.plugin.portalDiscoverer.setup;
// PLUGIN END //////////////////////////////////////////////////////////

setup.info = plugin_info; //add the script info data to the function as a property
if(!window.bootPlugins) window.bootPlugins = [];
window.bootPlugins.push(setup);
// if IITC has already booted, immediately run the 'setup' function
if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);


