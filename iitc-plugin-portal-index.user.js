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




class PortalIndexPlugin {
    constructor() {
        this.setupDesktop()
    }

    setupDesktop() {
        var a = $('<a tabindex="0">Portal Index</a>').click(this.showDialog.bind(this));
        $('#toolbox').append(a);
    }

    showDialog() {
        this.element = this.render()

        if (!this.dialog) {
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
        return $("<div>index...</div>")
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
