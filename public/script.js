let peer,
    mode = 0,
    isAuthorized = false;

const socket = io({ autoConnect: false, reconnection: false });

const mainButton = $('button[data-action="button"][data-property="main"]');

function setCameraOrientation(x, y) {
    peer.send(JSON.stringify({ action: 'camera', data: { x, y } }));
}

$('#cameraX, #cameraY').on('change', function () {
    const x = $('#cameraX').val();
    const y = $('#cameraY').val();

    peer.send(JSON.stringify({ action: 'camera', data: { x, y } }));
});

$('#cameraX-deg, #cameraY-deg').on('change', function () {
    const x = $('#cameraX-deg').val();
    const y = $('#cameraY-deg').val();

    peer.send(JSON.stringify({ action: 'camera-deg', data: { x, y } }));
});

$('input[type=range]').on('input', function () {
    $(this).trigger('change');
});

$('#cameraX-deg, #cameraY-deg').on('mouseup', function () {
    $(this).val(0);
    $(this).trigger('change');
});

const controllerPosition = {
    lat: 53.34912,
    lon: 17.64003,
};

const map = L.map('map').setView([controllerPosition.lat, controllerPosition.lon], 15);

const drawFlightPlan = true;

if (drawFlightPlan) {
    const waypointTypes = {
        21: 'Linear landing',
        16: 'Waypoint',
        2500: 'Start',
    };

    $.get('/flightplans/test', ({ waypoints }) => {
        waypoints = waypoints.filter((waypoint) => waypoint.lat && waypoint.lon);

        for (const waypoint of waypoints) {
            const type = waypointTypes[waypoint.type];

            L.marker([waypoint.lat, waypoint.lon])
                .addTo(map)
                .bindPopup(`#${waypoint.index} ${type} ${waypoint.alt.toFixed(0)}M`);
        }

        L.polyline(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon])).addTo(map);
    });
}

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Parrot Disco Live Map',
}).addTo(map);

const controllerLatLng = L.latLng(controllerPosition.lat, controllerPosition.lon);

const controllerMarker = L.marker([controllerPosition.lat, controllerPosition.lon])
    .addTo(map)
    .bindPopup('Virtual controller location');

const discoIcon = L.icon({
    iconUrl: '/disco.png',
    iconSize: [64, 64],
});

const discoMarker = L.marker([controllerPosition.lat, controllerPosition.lon], { icon: discoIcon })
    .addTo(map)
    .bindPopup('Disco location');

function connect() {
    socket.connect();

    socket.on('connect', function () {
        $(mainButton).text('Connected');

        mode = 1;
    });

    socket.on('disconnect', function () {
        $(mainButton).text('Disconnected');
        $(mainButton).attr('disabled', true);
        $('input').attr('disabled', true);

        try {
            peer.destroy();
        } catch {}

        mode = -1;
    });

    socket.on('signal', function (data) {
        if (!peer) {
            peer = new SimplePeer();

            peer.on('connect', () => {
                console.log('Peer connected');
            });

            peer.on('signal', function (signal) {
                socket.emit('signal', signal);
            });

            peer.on('stream', (stream) => {
                const video = document.querySelector('video');

                if ('srcObject' in video) {
                    video.srcObject = stream;
                } else {
                    video.src = window.URL.createObjectURL(stream);
                }

                try {
                    video.play();
                } catch {}
            });

            peer.on('data', (data) => {
                const packet = JSON.parse(data.toString());

                console.log(packet);

                if (packet.action === 'authorize') {
                    isAuthorized = true;

                    $('input').attr('disabled', false);
                } else if (packet.action === 'ping') {
                    peer.send(
                        JSON.stringify({
                            action: 'pong',
                            data: packet.data,
                        }),
                    );
                } else if (packet.action === 'battery') {
                    const batteryPercent = packet.data.percent;

                    $('*[data-action="battery"][data-property="percent"]').text(batteryPercent);

                    $('*[data-action="battery"][data-property="percent"]').css(
                        'color',
                        batteryPercent > 30 ? 'green' : 'red',
                    );
                } else if (packet.action === 'gps') {
                    if (packet.data.isFixed !== undefined) {
                        $('*[data-action="gps"][data-property="isFixed"]').css(
                            'color',
                            packet.data.isFixed ? 'green' : 'red',
                        );
                    }

                    if (packet.data.satellites !== undefined) {
                        $('*[data-action="gps"][data-property="satellites"]').text(packet.data.satellites);
                    }

                    if (packet.data.location !== undefined) {
                        const latLng = [packet.data.location.lat, packet.data.location.lon];

                        discoMarker.setLatLng(latLng);

                        map.panTo(latLng, {
                            animate: true,
                        });

                        const discoLatLng = L.latLng(packet.data.location.lat, packet.data.location.lon);

                        const distance = controllerLatLng.distanceTo(discoLatLng);

                        $('*[data-action="distance"][data-property="controller"]').text(distance.toFixed(0));
                    }
                } else if (packet.action === 'latency') {
                    const latency = packet.data;

                    $('*[data-action="connection"][data-property="latency"]').text(latency);

                    $('*[data-action="connection"][data-property="latency"]').css(
                        'color',
                        latency < 50 ? 'green' : 'red',
                    );
                } else if (packet.action === 'altitude') {
                    $('*[data-action="altitude"][data-property="meters"]').text(Number(packet.data.toFixed(1)));
                } else if (packet.action === 'canTakeOff') {
                    if (packet.data) {
                        $(mainButton).text('Take off');
                    } else {
                        $(mainButton).text("Can't take off");
                    }

                    if (isAuthorized) {
                        $(mainButton).attr('disabled', !packet.data);
                    }
                } else if (packet.action === 'flyingState') {
                    if (packet.data === 0) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Landed');
                    } else if (packet.data === 1) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Taking off');
                    } else if (packet.data === 2) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Hovering');
                    } else if (packet.data === 3) {
                        $('*[data-action="flyingState"][data-property="info"]').text('In flight');
                    } else if (packet.data === 4) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Landing');
                    } else if (packet.data === 5) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Emergency');
                    }
                } else if (packet.action === 'event') {
                } else if (packet.action === 'speed') {
                    const ms = packet.data;
                    const kmh = ms * 3.6;

                    $('*[data-action="speed"][property="m/s"]').text(ms.toFixed(1));
                    $('*[data-action="speed"][property="km/h"]').text(kmh.toFixed(0));
                }
            });
        }

        peer.signal(data);
    });
}

$(mainButton).on('click', function () {
    if (mode === 0) {
        $(mainButton).attr('disabled', true);
        $(mainButton).text('Connecting..');

        connect();
    } else if (mode === 1) {
        peer.send(JSON.stringify({ action: 'takeOff' }));
    }
});
