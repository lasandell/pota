const parkIndexUrl = 'data/index.json';
const MY_CALLSIGN = "KN4FVR";

let map;
let parkSummaryDataGlobal = []; 
let contactMarkersLayer = L.layerGroup();
let contactLinesLayer = L.layerGroup();
let myLocationMarker;

const blueIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const redIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});


function getGridCorner(grid) {
    if (!grid || typeof L.Maidenhead.indexToBBox !== 'function') { return null; }
    try {
        if (grid.length < 2) { return null; }
        const bbox = L.Maidenhead.indexToBBox(grid); 
        if (!bbox || bbox.length !== 4 || bbox.some(isNaN)) { return null; }
        const cornerLat = bbox[0]; 
        const cornerLon = bbox[1];
        if (isNaN(cornerLat) || isNaN(cornerLon)) { return null; }
        return [cornerLat, cornerLon];
    } catch (e) {
        return null;
    }
}

function createContactPopupContent(locationData, qsoDataForPopup) {
    const callLink = `https://www.qrz.com/db/${locationData.callsign}`;
    
    if (locationData.type === 'p2p_precise') {
        const template = document.getElementById('p2pContactPopupTemplate').innerHTML;
        const parkFullName = `${qsoDataForPopup.sig_name || ''} ${qsoDataForPopup.sig_type || ''}`.trim();
        const parkLink = `<a href="${qsoDataForPopup.sig_web || '#'}" target="_blank">${parkFullName}</a>`;
        const view = {
            callsign: locationData.callsign,
            callLink: callLink,
            name: qsoDataForPopup.name || null,
            parkLink: parkLink,
            distance: locationData.distance || null,
            mode: qsoDataForPopup.mode || 'N/A',
            band: qsoDataForPopup.band || 'N/A'
        };
        return Mustache.render(template, view);
    }

    const template = document.getElementById('contactPopupTemplate').innerHTML;
    const view = {
        callsign: locationData.callsign,
        callLink: callLink,
        name: qsoDataForPopup.name || null,
        locationString: qsoDataForPopup.city && qsoDataForPopup.state ? `${qsoDataForPopup.city}, ${qsoDataForPopup.state}` : (qsoDataForPopup.city || qsoDataForPopup.state || null),
        distance: locationData.distance || null,
        mode: qsoDataForPopup.mode || 'N/A',
        band: qsoDataForPopup.band || 'N/A'
    };
    return Mustache.render(template, view);
}

function createMyPopupContent(parkData) {
    const template = document.getElementById('myLocationPopupTemplate').innerHTML;
    const datePart = parkData.date || "";
    let displayDate = "";
    if(datePart.length === 8){
        displayDate = `${datePart.substring(0,4)}-${datePart.substring(4,6)}-${datePart.substring(6,8)}`;
    }
    const fullParkName = `${parkData.name || "Unknown Park"} ${parkData.type || ''}`.trim();

    const view = {
        parkLink: `<a href="${parkData.web || '#'}" target="_blank">${fullParkName}</a>`,
        activationDate: displayDate || 'N/A',
        qsos: parkData.qsos || 0
    };
    return Mustache.render(template, view);
}

async function initializeParkSelector() {
    const loadingMessage = document.getElementById('loading-message');
    const parkSelector = document.getElementById('parkTitleSelector'); 
    loadingMessage.innerHTML = 'Loading park index...';
    loadingMessage.style.display = 'block';

    try {
        const response = await fetch(parkIndexUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} fetching park index`);
        parkSummaryDataGlobal = await response.json();
        if (!parkSummaryDataGlobal || parkSummaryDataGlobal.length === 0) throw new Error("Park summary data is empty or invalid.");

        parkSummaryDataGlobal.sort((a, b) => {
            const tsA = (a.date || "0") + (a.time || "0000"); 
            const tsB = (b.date || "0") + (b.time || "0000");
            if (tsB < tsA) return -1;
            if (tsB > tsA) return 1;
            return 0;
        });

        parkSummaryDataGlobal.forEach((park, index) => {
            const option = document.createElement('option');
            option.value = index; 
            option.textContent = `${park.ref}: ${park.name} (${park.date.substring(0,4)}-${park.date.substring(4,6)}-${park.date.substring(6,8)})`;
            parkSelector.appendChild(option);
        });

        parkSelector.addEventListener('change', function() {
            const selectedParkIndex = this.value;
            if (parkSummaryDataGlobal[selectedParkIndex]) {
                loadMapForSelectedPark(parkSummaryDataGlobal[selectedParkIndex]);
            }
        });

        if (parkSummaryDataGlobal.length > 0) {
            loadMapForSelectedPark(parkSummaryDataGlobal[0]); 
        } else {
                loadingMessage.textContent = 'No parks found in index.';
                loadingMessage.style.display = 'block'; 
        }

    } catch (error) {
        console.log("Error initializing park selector:", error);
        loadingMessage.textContent = `Error loading park index: ${error.message}`;
        loadingMessage.style.display = 'block'; 
    }
}

async function loadMapForSelectedPark(parkData) {
    const loadingMessage = document.getElementById('loading-message');
    let contactsData;

    loadingMessage.innerHTML = `Fetching contacts for ${parkData.ref}...`;
    loadingMessage.style.display = 'block';

    contactMarkersLayer.clearLayers();
    contactLinesLayer.clearLayers();
    if (myLocationMarker) {
        map.removeLayer(myLocationMarker);
    }

    try {
        const parkRef = parkData.ref;
        const parkDate = parkData.date; 
        const parkTime = parkData.time || "0000"; 
        const parkLat = parseFloat(parkData.lat);
        const parkLon = parseFloat(parkData.lon);

        if (isNaN(parkLat) || isNaN(parkLon)) throw new Error(`Invalid LAT/LON for park ${parkRef}`);

        const fullTimestampForFile = parkDate + parkTime;
        const contactsFileUrl = `data/${fullTimestampForFile}_POTA_${parkRef}.json`;
        console.log("Fetching contacts from:", contactsFileUrl);
        
        const response = await fetch(contactsFileUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status} fetching contacts from ${contactsFileUrl}`);
        contactsData = await response.json();
        if (!contactsData) throw new Error("Contacts data is empty or invalid for selected park.");
        
        loadingMessage.innerHTML = 'Data fetched. Plotting map...';

        const myLatLng = L.latLng(parkLat, parkLon);

        myLocationMarker = L.marker(myLatLng, { 
            icon: redIcon
        }).addTo(map).bindPopup(createMyPopupContent(parkData)).openPopup();

        const allCoordsForBounds = [[parkLat, parkLon]];
        const contactLocationsCache = {}; 
        
        contactsData.forEach(qso => {
            const call = qso.call;
            let contactData = contactLocationsCache[call]; 

            if (!contactData) { 
                let contactCoords; 

                if (qso.sig_ref && qso.sig_lat && qso.sig_lon) {
                    const sigLat = parseFloat(qso.sig_lat);
                    const sigLon = parseFloat(qso.sig_lon);
                    if (!isNaN(sigLat) && !isNaN(sigLon)) {
                        contactData = {
                            callsign: call, lat: sigLat, lon: sigLon,
                            type: 'p2p_precise', state: qso.state || null
                        };
                    }
                } 
                
                if (!contactData && qso.grid) {
                    contactCoords = getGridCorner(qso.grid); 
                    if (contactCoords) {
                        contactData = {
                            callsign: call, lat: contactCoords[0], lon: contactCoords[1],
                            type: 'grid_corner', state: qso.state || null 
                        };
                    }
                } 
                
                if (!contactData) {
                    console.log(`Contact ${call} has no valid location (P2P lat/lon or grid). Cannot plot.`); 
                    contactData = { callsign: call, error: true, message: `No location for ${call}.` };
                }
                
                if (!contactData.error && myLatLng && !isNaN(contactData.lat) && !isNaN(contactData.lon)) {
                    const contactLatLngForDist = L.latLng(contactData.lat, contactData.lon);
                    const distMeters = myLatLng.distanceTo(contactLatLngForDist);
                    contactData.distance = isNaN(distMeters) ? null : (distMeters * 0.000621371).toFixed(0);

                    contactLocationsCache[call] = contactData; 
                    allCoordsForBounds.push([contactData.lat, contactData.lon]);
                    
                    const markerIcon = contactData.type === 'p2p_precise' ? greenIcon : blueIcon;
                    
                    const marker = L.marker([contactData.lat, contactData.lon], { 
                        icon: markerIcon
                    }).bindPopup(createContactPopupContent(contactData, qso));
                    contactMarkersLayer.addLayer(marker);

                } else if (contactData.error) {
                        console.log(`Skipping marker for ${call}: ${contactData.message}`); 
                }
            }
            
            const currentContactLocationData = contactLocationsCache[call];
            if (currentContactLocationData && !currentContactLocationData.error && myLatLng &&
                !isNaN(myLatLng.lat) && !isNaN(myLatLng.lng) &&
                !isNaN(currentContactLocationData.lat) && !isNaN(currentContactLocationData.lon)) { 
                
                const lineColor = '#FF00FF'; 
                const contactLatLng = L.latLng(currentContactLocationData.lat, currentContactLocationData.lon);
                
                const line = L.polyline([myLatLng, contactLatLng], { 
                    color: lineColor, 
                    weight: 2.5, 
                    opacity: 0.75 
                });
                contactLinesLayer.addLayer(line);
            }
        });
        
        contactMarkersLayer.addTo(map);
        contactLinesLayer.addTo(map);

        if (allCoordsForBounds.length > 1) {
            const validBoundsCoords = allCoordsForBounds.filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
            if (validBoundsCoords.length > 0) {
                    map.fitBounds(L.latLngBounds(validBoundsCoords), { padding: [50, 50] });
            }
        } else if (allCoordsForBounds.length === 1 && !isNaN(allCoordsForBounds[0][0]) && !isNaN(allCoordsForBounds[0][1])) {
            map.setView(allCoordsForBounds[0], 6); 
        }
        loadingMessage.style.display = 'none';

    } catch (error) { 
        console.log("Error during map update for selected park:", error); 
        loadingMessage.textContent = `Error: ${error.message}. Check console.`;
    }
}

map = L.map('map').setView([39.8283, -98.5795], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
initializeParkSelector();
