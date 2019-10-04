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
    static dbVersion() { return 2 }

    static initialState() {
        return {
            'searchRegions': JSON.parse(localStorage.getItem('portal-index-search-regions') || "[]"),
            'newPortals': [],
        }
    }

    openDatabase() {
        var request = window.indexedDB.open(PortalIndexPlugin.dbName(), PortalIndexPlugin.dbVersion())
        request.onsuccess = (e) => { 
            this.db = e.target.result 
            this.processQueues();
        } 
        request.onerror = (e) => console.log("PINDEX open database error", e)
        request.onupgradeneeded = (e) => this.upgradeDb(e)
    }

    upgradeDb(e) {
        var db = e.target.result;

        if (e.newVersion == 2) {
            //schema initialize
            var portals = db.createObjectStore("portals", {keyPath: "guid"})
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
              width: '400px',
              closeCallback: () => this.handleCloseDialog()
            }).dialog('option', 'buttons', {
              'OK': function() { $(this).dialog('close') },
            });
        }
    }

    handleCloseDialog() {
        this.dialog = undefined
    }

    render() {
        var el = $('<div></div>')

        // regions
        el.append('<h3>Search Regions</h3>')
        var regions = $('<div></div>')
        el.append(regions)
        if (this.state.searchRegions.length == 0) {
            regions.append('<p>No regions selected.</p>')
        }
        this.state.searchRegions.forEach(region => {
            var row = $(`<div>${region.label} </div>`)
            var deleteButton = $('<span>X</span>').click((e) => this.removeSearchRegion(region.stamp))
            row.append(deleteButton)
            regions.append(row)
        })

        var definedStamps = this.state.searchRegions.map(r => r.stamp)
        var regions = this.getDrawnRegions().filter(l => definedStamps.indexOf(L.stamp(l)) == -1)

        var regionSelect = $('<select></select>')
        regionSelect.append('<option value="">Add region</option>')
        if (regions.length > 0) {
            regions.forEach(l => {
                regionSelect.append(`<option value="${l._leaflet_id}">${this.labelForLayer(l)}</option>`)
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
        el.append(regionSelect)


        //index stats
        el.append('<h3>Index</h3>')
        var countDiv = $('<div>Portals in Index: </div>')
        this.countIndex().then((count) => {countDiv.append(count)}, () => {})
        el.append(countDiv)

        if (this.state.newPortals.length > 0) {
            var newDiv = $(`<div>Recently Discovered Portals</div>`)
            this.state.newPortals.slice(0,4).forEach(p => {
                var row = $(`<div>${p.name}</div>`)
                row.click(() => selectPortalByLatLng(p.latE6/1e6, p.lngE6/1e6)) 
                newDiv.append(row)
            })
            el.append(newDiv)
        }


        var button = $('<button>Save KML</button>')
        button.click(() => this.saveAsKml())
        el.append(button)


        return el[0];
    }

    labelForLayer(layer) {
        var area = L.GeometryUtil.geodesicArea(layer.getLatLngs())
        var readable = L.GeometryUtil.readableArea(area)
        if (layer._mRadius) {
            return `Circle ${readable}`
        }
        else
        if (layer instanceof L.Polygon) {
            return `Polygon ${readable}`
        }
    }

    addSearchRegion(layer) {
        var region = {
            stamp: L.stamp(layer),
            label: this.labelForLayer(layer),
        }
        if (layer._mRadius) {
            region.radius = layer.getRadius()
            region.latlng = layer.getLatLng()
        }
        else if (layer instanceof L.Polygon) {
            region.latlngs = layer.getLatLngs()
        }
        this.setState({
            'searchRegions': this.state.searchRegions.concat([region])
        }, () => this.saveSearchRegions())
    }
    removeSearchRegion(stamp) {
        this.setState({
            'searchRegions': this.state.searchRegions.filter(r => r.stamp != stamp)
        }, () => this.saveSearchRegions())

    }

    saveSearchRegions() {
        localStorage.setItem('portal-index-search-regions', JSON.stringify(this.state.searchRegions))
    }

    getDrawnRegions() {
        var layers = plugin.drawTools.drawnItems.getLayers()
        return layers.filter(l => (l instanceof L.Circle || l instanceof L.Polygon))
    }

    portalInSearchRegions(portal) {
        return this.state.searchRegions.map(region => this.portalInRegion(portal, region)).filter(_ => _ === true).length > 0
    }

    portalInRegion(portal, region) {
        if (region.radius !== undefined) {
            var center = new L.LatLng(region.latlng.lat, region.latlng.lng)
            return center.distanceTo(portal.getLatLng()) <= region.radius
        }
        else {
            return _point_in_polygon([portal._latlng.lat, portal._latlng.lng], region.latlngs.map(ll => [ll.lat, ll.lng]))
        }

    }

    getAllPortals() {
        return new Promise((resolve, reject) => {
            var results = []
            this.portals.openCursor().onsuccess = (e) => {
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








PortalIndexPlugin.boot = function() {
    window.plugin.portalIndex = new PortalIndexPlugin()
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
