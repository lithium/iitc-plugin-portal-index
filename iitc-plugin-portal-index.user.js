// ==UserScript==
// @id             iitc-plugin-portal-index@nobody889
// @name           IITC plugin: Portal Index
// @category       Cache
// @version        2.0.5
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @description    [iitc-2017-01-08-021732] index portals using IndexedDB and generate KMLs
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


class SearchRegion {
    constructor(options) {
        this.layer = options.layer 
        this.doc = options.doc
    }

    get label() {
        if (this.doc) return this.doc.label

        if (this.layer) {
            var area = L.GeometryUtil.geodesicArea(this.layer.getLatLngs())
            var readable = L.GeometryUtil.readableArea(area)
            if (this.layer._mRadius) {
                return `Circle ${readable}`
            }
            else
            if (this.layer instanceof L.Polygon) {
                return `Polygon ${readable}`
            }
        } 
    }

    get guid() {
        if (this.doc) return this.doc.guid

        var latlngs = this.layer._mRadius ? [this.layer.getLatLng()] : this.layer.getLatLngs()
        return latlngs.map(ll => `${ll.lat},${ll.lng}`).join("|")
    }

    getDocument() {
        if (this.doc) return this.doc

        var doc = {
            guid: this.guid,
            label: this.label
        }
        if (this.layer._mRadius) {
            doc.radius = this.layer.getRadius()
            doc.latlng = this.layer.getLatLng()
        }
        else if (this.layer instanceof L.Polygon) {
            doc.latlngs = this.layer.getLatLngs()
        }
        return doc
    }

    containsPortal(portal) {
        var doc = this.getDocument()
        if (doc.radius) {
            var center = new L.LatLng(doc.latlng.lat, doc.latlng.lng)
            return center.distanceTo(portal.getLatLng()) <= doc.radius
        }
        else {
            return _point_in_polygon([portal._latlng.lat, portal._latlng.lng], doc.latlngs.map(ll => [ll.lat, ll.lng]))
        }

    }
}


class UIComponent {
  constructor(properties) {
    this.props = Object.assign(this.constructor.defaultProps(), properties)
    this.state = this.constructor.initialState()
    this.mount();
  }

  static initialState() {
    return {}
  }

  static defaultProps() {
    return {}
  }

  mount(el) {
    this.element = el || document.createElement('div') 
    this.update()
  }

  setState(newState, thenF) {
    Object.assign(this.state, newState)
    this.update()
    if (thenF !== undefined) {
        thenF.apply(this)
    }
  }

  update() {
    this.element.innerHTML = "";
    this.element.appendChild(this.render());
  }
}





class PortalIndexPlugin extends UIComponent {
    constructor() {
        super()

        this.db = null
        this.portalQueue = [];

        this.setupDesktop()

        this.openDatabase()

        addHook('portalAdded', this.handlePortalAdded.bind(this));
    }

    static dbName() { return 'portal-index' }
    static dbVersion() { return 1 }

    static initialState() {
        return {
            'searchRegions': [],
            'newPortals': [],
        }
    }

    openDatabase() {
        var request = window.indexedDB.open(PortalIndexPlugin.dbName(), PortalIndexPlugin.dbVersion())
        request.onsuccess = (e) => { 
            this.db = e.target.result 
            this.processQueues();
            this.loadRegions();
        } 
        request.onerror = (e) => console.log("PINDEX open database error", e)
        request.onupgradeneeded = (e) => this.upgradeDb(e)
    }

    upgradeDb(e) {
        var db = e.target.result;

        if (e.newVersion == 1) {
            //schema initialize
            var portals = db.createObjectStore("portals", {keyPath: "guid"})
            var regions = db.createObjectStore("regions", {keyPath: "guid"})
        }
    }

    handlePortalAdded(data) {
        var portal = data.portal

        if (!this.portalInSearchRegions(portal))  {
            // console.log("PINDEX portal outside region", portal.options.data.title)
            return;
        }

        if (!this.db) {
            console.log("PINDEX portal queue", portal)
            this.portalQueue.push(data)
            return
        }

        var doc = { 
            name: portal.options.data.title,
            guid: portal.options.guid,
            latE6: portal.options.data.latE6,
            lngE6: portal.options.data.lngE6,
            timestamp: Date.now(),
            history: [],
        }
        if (window.plugin.regions) {
            doc.region = window.plugin.regions.regionName(S2.S2Cell.FromLatLng(portal.getLatLng(), 6));
        }

        this.checkInPortal(doc)
    }

    checkInPortal(doc) {
        this.lookupPortal(doc.guid).then(existing => {
            if (existing) {
                // console.log("PINDEX skip existing", existing)
            } else {
                // console.log("PINDEX saving new", doc)
                this.savePortal(doc).then(() => {
                    this.setState({
                        'newPortals': this.state.newPortals.concat([doc])
                    })
                })
            }
        })
    }

    lookupPortal(guid) {
        return new Promise((resolve, reject) => {
            var request = this.portals.get(guid)
            request.onsuccess = (e) => resolve(request.result) 
            request.onerror = (e) => reject(e)
        })
    }

    savePortal(doc) {
        return new Promise((resolve, reject) => {
            var request = this.portals.add(doc)
            request.onsuccess = (e) => resolve(e)
            request.onerror = (e) => reject(e)
        })
    }

    countIndex() {
        if (!this.db) {
            return new Promise((resove, reject) => {reject()})
        }

        return new Promise((resolve, reject) => {
            var request = this.portals.count()
            request.onsuccess = (e) => resolve(request.result)
            request.onerror = (e) => reject(e)
        })
    }

    get portals() {
        if (this.db) {
            return this.db.transaction("portals", "readwrite").objectStore("portals")
        }
    }
    get regions() {
        if (this.db) {
            return this.db.transaction("regions", "readwrite").objectStore("regions")
        }
    }

    processQueues() {
        if (!this.db)
            return;

        console.log("PINDEX processing queues")
        this.portalQueue.forEach(data => this.handlePortalAdded(data))
        this.portalQueue = [];
    }

    setupDesktop() {
        var a = $('<a tabindex="0">Portal Index</a>').click(this.showDialog.bind(this));
        $('#toolbox').append(a);
    }

    showDialog() {
        if (!this.dialog) {
            this.setState({})

            this.dialog = dialog({
              title: "Portal Index",
              html: this.element,
              height: 'auto',
              width: '20em',
              closeCallback: () => this.handleCloseDialog()
            }).dialog('option', 'buttons', {
              'Save KML': () => { this.saveAsKml() },
              'OK': function() { $(this).dialog('close') },
            });
        }
    }

    handleCloseDialog() {
        this.dialog = undefined
    }

    render() {
        var el = $('<div></div>')

        var countDiv = $('<h3>Portals in Index: </h3>')
        this.countIndex().then((count) => {countDiv.append(count)}, () => {countDiv.append(0)})
        el.append(countDiv)

        // regions
        var regionPane = $('<div class="regions"></div>')
        el.append(regionPane)
        regionPane.append('<h3>Search Regions</h3>')
        if (this.state.searchRegions.length == 0) {
            regionPane.append('<div class="row">No regions selected.</p>')
        }
        this.state.searchRegions.forEach(region => {
            var row = $(`<div class="row"> ${region.label}</div>`)
            var deleteButton = $('<div class="delete">🞨</div>').click((e) => this.removeSearchRegion(region.guid))
            row.prepend(deleteButton)
            regionPane.append(row)
        })

        var definedRegions = this.state.searchRegions.map(r => r.guid)
        var regions = this.getDrawnLayers().map(l => new SearchRegion({layer: l})).filter(r => definedRegions.indexOf(r.guid) == -1)

        var regionSelect = $('<select></select>')
        regionSelect.append('<option value="">Add region</option>')
        if (regions.length > 0) {
            regions.forEach(r => {
                regionSelect.append(`<option value="${r.layer._leaflet_id}">${r.label}</option>`)
            })
        }
        else if (this.state.searchRegions.length == 0) {
            regionSelect.empty()
            regionSelect.append('<option value="">Draw circles or polygons to define regions</option>')
        }

        regionSelect.change(e => {
            var layer = plugin.drawTools.drawnItems.getLayer(regionSelect.val())
            this.addSearchRegion(layer)
        })
        regionPane.append(regionSelect)


        // recently discovered
        if (this.state.newPortals.length > 0) {
            var indexPane = $('<div class="index"></div>')
            el.append(indexPane)

            indexPane.append(`<h3>Recently Discovered</h3>`)
            var newDiv = $('<div class="portals"></div>')
            this.state.newPortals.slice(0,5).forEach(p => {
                var row = $(`<div class="row"><a href="#">${p.name}</a></div>`)
                row.click(() => selectPortalByLatLng(p.latE6/1e6, p.lngE6/1e6)) 
                newDiv.append(row)
            })
            indexPane.append(newDiv)
        }


        return el[0];
    }

    addSearchRegion(layer) {
        var region = new SearchRegion({layer: layer})

        this.setState({
            'searchRegions': this.state.searchRegions.concat([region])
        }, () => this.saveSearchRegions())
    }
    removeSearchRegion(guid) {
        this.regions.delete(guid)
        this.setState({
            'searchRegions': this.state.searchRegions.filter(r => r.guid != guid)
        })

    }

    saveSearchRegions() {
        this.state.searchRegions.forEach(region => {
            this.regions.add(region.getDocument())
        })
    }

    getDrawnLayers() {
        var layers = plugin.drawTools.drawnItems.getLayers()
        return layers.filter(l => (l instanceof L.Circle || l instanceof L.Polygon))
    }

    portalInSearchRegions(portal) {
        return this.state.searchRegions.map(region => region.containsPortal(portal)).filter(_ => _ === true).length > 0
    }

    portalInRegion(portal, region) {
        if (region._mRadius) {
            var center = new L.LatLng(region.latlng.lat, region.latlng.lng)
            return this.layer.getLatLng().distanceTo(portal.getLatLng()) <= this.getRadius()
        }
        else {
            return _point_in_polygon([portal._latlng.lat, portal._latlng.lng], region.layer.getLatLngs().map(ll => [ll.lat, ll.lng]))
        }

    }

    loadRegions() {
        this.getAll(this.regions).then(regions => {
            this.setState({searchRegions: regions.map(d => new SearchRegion({doc: d}))})
        })
    }
    getAllPortals() {
        return this.getAll(this.portals)
    }

    getAll(transaction) {
        return new Promise((resolve, reject) => {
            var results = []
            transaction.openCursor().onsuccess = (e) => {
                var cursor = e.target.result
                if (cursor) {
                    results.push(cursor.value)
                    cursor.continue()
                } else {
                    resolve(results)
                }
            }
        })
    }

    saveAsKml() {
        this.getAllPortals().then((portals) => {
            var kml = this.generateKml(portals)

            var a = document.createElement('a')
            a.setAttribute('href', "data:application/octet-stream;base64,"+btoa(kml))
            a.setAttribute('download', "ingress-portal-index.kml")
            a.style.display = 'none'
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a);
        })
    }

    generateKml(portals) {
        var placemarks = portals.map(p => `
        <Placemark>
            <name>${p.name}</name>
            <visibility>1</visibility>
            <description>https://www.ingress.com/intel?ll=${p.latE6/1e6},${p.lngE6/1e6}&amp;z=17</description>
            <Point>
                <coordinates>${p.lngE6/1e6},${p.latE6/1e6}</coordinates>
            </Point>
            <TimeStamp>
                <when>${new Date(p.timestamp).toISOString()}</when>
            </TimeStamp>
            <ExtendedData>
                <Data name="LATE6"><value>${p.latE6}</value></Data>
                <Data name="LNGE6"><value>${p.lngE6}</value></Data>
                <Data name="GUID"><value>${p.guid}</value></Data>
                <Data name="REGION"><value>${p.region}</value></Data>
            </ExtendedData>
        </Placemark>`)
        return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
    <Document id="ingress-portal-index">
        <name>ingress-portal-index.kml</name>
        <visibility>1</visibility>
        <open>1</open>
        ${placemarks}
    </Document>
</kml>`
    }

}

PortalIndexPlugin.css = `

.index {
    padding-top: 2em;
}

.regions select {
    margin-top: 1em;
    margin-left: 5em;
}

.row {
    padding: 3px;
}
.row .delete {
    float: left;
    margin-right: 8px;
    cursor: pointer;
}

.ui-dialog-buttonset button {
    margin-left: 1em;
}
`;







PortalIndexPlugin.boot = function() {
    window.plugin.portalIndex = new PortalIndexPlugin()

    var style = document.createElement('style')
    style.appendChild(document.createTextNode(PortalIndexPlugin.css))
    document.head.appendChild(style)

}






var setup = PortalIndexPlugin.boot;
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
