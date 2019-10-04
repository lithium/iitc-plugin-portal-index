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

        this.setupDesktop()

        // addHook('portalAdded', this.handlePortalAdded.bind(this));
    }

    static initialState() {
        return {
            'searchRegions': JSON.parse(localStorage.getItem('portal-index-search-regions') || "[]")
        }
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

        el.append('<h3>Search Regions</h3>')
        var regions = $('<div></div>')
        el.append(regions)
        this.state.searchRegions.forEach(region => {
            var row = $(`<div>${region.label} </div>`)
            var deleteButton = $('<span>X</span>').click((e) => this.removeSearchRegion(region.stamp))
            row.append(deleteButton)
            regions.append(row)
        })

        var definedStamps = this.state.searchRegions.map(r => r.stamp)
        var regions = this.getDrawnRegions().filter(l => definedStamps.indexOf(L.stamp(l)) == -1)

        var regionSelect = $('<select></select>')
        regionSelect.append('<option value="">Add new region</option>')
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
        console.log("PINDEX add region", layer, region)
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
        console.log("PINDEX region saved", this.state.searchRegions)
        localStorage.setItem('portal-index-search-regions', JSON.stringify(this.state.searchRegions))
    }

    getDrawnRegions() {
        var layers = plugin.drawTools.drawnItems.getLayers()
        return layers.filter(l => (l instanceof L.Circle || l instanceof L.Polygon))
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
