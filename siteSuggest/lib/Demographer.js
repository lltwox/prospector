/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Initial Developer of the Original Code is the Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011 the
 * Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const file = require("file");
const widgets = require("widget");
const tabs = require("tabs");
const request = require("request");
const timers = require("timers");
const windows = require("windows");
const simpleStorage = require("simple-storage");
const preferences = require("preferences-service");
const {PageMod} = require("page-mod");
const {data} = require("self");
const passwords = require("passwords");

const {Cc,Ci,Cm,Cr,Cu,components} = require("chrome");

Cm.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import("resource://gre/modules/PlacesUtils.jsm", this);
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
Cu.import("resource://gre/modules/Services.jsm", this);

const historyUtils = require("HistoryUtils");

function Demographer( sitesCatFile ) {
    this.catFile = sitesCatFile;

	this.totalVisits = 0;
	this.catDepth = 2;

    this.allSites = {};
    this.mySites = {};
	this.cats = {};
	this.readCats( );
	this.readHistory( );
}

Demographer.prototype = {

  clearCats: function( ) {
    this.totalVisits = 0;
  	this.cats = {};
  },

  rebuild: function ( cb ) {
  	this.clearCats( );
	this.mySites = {};
	this.readHistory( cb );
  },

  extractDomain: function ( url ) {

    // now we need to grep the domain 
      let domain = require("url").URL( url ).host;

      // and make sure to get rid of www
      let re = /^www[.]/;
      domain = domain.replace( re , "" );

      // ok check if site is present in our global site list
      let siteData = this.allSites[ domain ];

      while( ! siteData ) {  // attempt to go to the root domain
           domain = domain.replace( /^[^.]+[.]/ , "" );
           //console.log( "cutting to " + domain );
           if( domain.indexOf( "." ) <  0) {
               domain  = null;
               break;
           }  // no need to go further
           siteData = this.allSites[ domain ];
      }

	  return ( siteData ) ? domain : null;
  },

  readHistory: function ( cb ) {
  try {
    console.log( "getting it " );
	let query = "select visit_count , url from moz_places where visit_count >= 1";
    historyUtils.executeHistoryQuery( query , null , 
	   {
	     onRow: function ( row ) {
		   let vcount = row.getResultByIndex( 0 );
           let url = row.getResultByIndex( 1 );

		   // now we need to grep the domain 
		   let domain = this.extractDomain( url );
		   if( ! domain ) return;   // bail if domain is empty

 			let site = this.mySites[ domain ];
			if( !this.mySites[ domain ] ) {
				this.mySites[ domain ]  = 0;
			}
			this.mySites[ domain ] += vcount;
       	}.bind( this ) ,

		onCompletion: function ( reason ) {
			this.computeSitesData( );
			if( cb ) {
				cb( );  // execute call back
			}
		}.bind( this ) ,

		onError: function ( error ) {
			console.log( error );
		}.bind( this ) ,
	 });
    } catch ( ex ) { console.log( "ERROR " + ex ); }
  },

  computeSitesData: function( ) {
  	for ( domain in this.mySites ) {
	    this.processHistorySite( domain );
	}
	this.normalize( );
	//console.log( "CATS " + JSON.stringify( this.cats) );
  },

  processHistorySite: function( domain ) {

  	// ok check if site is present 
	let siteData = this.allSites[ domain ];
	let vcount = this.mySites[ domain ];

	if( ! siteData || !vcount || vcount == 0 ) return;   // domain is not found

    vcount = Math.log( vcount );  // log the count

    // add it to the soup
	if( siteData.cats ) {
	    let addedHash = {};
		siteData.cats.forEach( function ( category ) {
			this.addToCategory( domain , category , vcount , addedHash );
		}.bind( this ));
		this.totalVisits += vcount;
	} 
  },

  addToCategory: function( domain , cat , count , addedHash ) {
  	// for now simply take the top ones
	//let top = cat.replace( /\/.*/ , "" );
	let them = cat.split( "/" );
	let top = them.shift( );
	let depth = 1;
	while( them.length && depth < this.catDepth ) {
		top += "/" + them.shift( );
		depth ++;
	}
	// check if we saw this category already
	if( addedHash[ top ] ) {
		return;
	} 

	addedHash[ top ] = 1;

	if( ! this.cats[ top ]  ) { 
		this.cats[ top ] = 0;
	}
	this.cats[ top ] += count;
  },

  readCats: function ( ) {
  		// read the file first
		let sites = data.load( this.catFile );
		// split by new lines
		sites.split( /\n/ ).forEach( function( line ) {
				// figure site , rank and cat
				let data = line.split( / / );
				let domain = data.shift( );
				if( domain == "" ) return;   // empty domain
				let site = this.allSites[ domain ];
				if( site  == undefined  ) {
					site = {};
					site.cats = [];
					this.allSites[ domain ] = site;
				}
			    //siteFoo.rank = data[1];
				data.forEach( function( item ) {
				    if( item && item != "" && item.indexOf("Regional") != 0 ) {
			    		site.cats.push( item );
					}
				});

				if( site.cats.length == 0 ) {
					delete this.allSites[ domain ];
				}

		 }.bind(this));
  },

  getInterests: function( ) {

  	return this.cats;

  },

  normalize: function( ) {
  	Object.keys( this.cats ).forEach( function ( key ) {
		this.cats[ key ]  =  this.cats[ key ] * 100.0 / this.totalVisits ;
	}.bind( this ));
  },

}


exports.Demographer = Demographer;

