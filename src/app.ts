import express, { Application } from 'express';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import wrtc from 'wrtc';
import fs from 'fs/promises';
import { constants } from 'fs';

import Peer from 'simple-peer';
import ParrotDisco from 'parrot-disco-api';
import { Server } from 'http';

import logger from './utils/logger';
import paths, { Paths } from './utils/paths';

import { ParrotDiscoFlyingState } from 'parrot-disco-api/build/enums/ParrotDiscoFlyingState.enum';

const startWithoutDisco: boolean = !!process.env.NO_DISCO;

let disco: ParrotDisco = new ParrotDisco({
    debug: !!process.env.DEBUG,
    ip: process.env.DISCO_IP || '192.168.42.1',
});

const localCache: {
    gpsFixed?: boolean;
    altitude?: number;
    flyingState?: ParrotDiscoFlyingState;
    canTakeOff?: boolean;
    sensorStates?: { [key: string]: boolean };
    cameraMaxTiltSpeed?: number;
    cameraMaxPanSpeed?: number;
} = {
    gpsFixed: false,
    altitude: 0,
    flyingState: ParrotDiscoFlyingState.LANDED,
    canTakeOff: false,
    sensorStates: {},
    cameraMaxTiltSpeed: 0,
    cameraMaxPanSpeed: 0,
};

let videoOutput;

if (!startWithoutDisco) {
    (async () => {
        logger.info(`Connecting to drone..`);

        const isConnected: boolean = await disco.connect(true);

        if (!isConnected) {
            logger.error(`Disco not connected!`);

            process.exit(1);
        }

        logger.info(`Parrot Disco connected!`);

        logger.info(`Enabling video stream..`);

        disco.MediaStreaming.enableVideoStream();

        logger.info(`Starting video output to media stream..`);

        videoOutput = await require('wrtc-to-ffmpeg')(wrtc).output({
            kind: 'video',
            width: 856,
            height: 480,
        });

        ffmpeg()
            .input(paths[Paths.SDP])
            .inputOption('-protocol_whitelist file,udp,rtp')
            .output(videoOutput.url)
            .outputOptions(videoOutput.options)
            .on('start', (command) => logger.debug(`ffmpeg started:`, command))
            .on('error', (error) => logger.error(`ffmpeg failed:`, error))
            .run();
    })();
} else {
    logger.info(`Starting without disco`);
}

const port: number = Number(process.env.PORT || '8000');

const app: Application = express();

const server: Server = app.listen(port, () => logger.info(`Server listening on ${port}`));

app.get('/flightplans/:name', async (req, res) => {
    const { name } = req.params;

    const flightPlanName: string = name + '.mavlink';

    const flightPlanPath: string = join(paths[Paths.FLIGHT_PLANS], flightPlanName);

    try {
        await fs.access(flightPlanPath, constants.F_OK);
    } catch {
        return res.sendStatus(404);
    }

    const file: string = await fs.readFile(flightPlanPath, 'utf-8');
    const lines = file
        .split(/\r?\n/g)
        .slice(1)
        .filter(Boolean)
        .map((line) => line.split(/\t/g));

    const waypoints = lines.map((o) => ({
        index: Number(o[0]),
        type: Number(o[3]),
        lat: Number(o[8]),
        lon: Number(o[9]),
        alt: Number(o[10]),
    }));

    res.json({
        name,
        waypoints,
    });
});

app.use(express.static(paths[Paths.PUBLIC]));

let isFirstAuthorized = false;

const io = require('socket.io')(server);

let clients = [];

const sendPacketToEveryone = (packet) => {
    logger.debug(`Sending packet to everyone: ${JSON.stringify(packet)}`);

    for (const client of clients) {
        try {
            client.peer.send(JSON.stringify(packet));
        } catch {}
    }
};

disco.on('BatteryStateChanged', ({ percent }) => {
    sendPacketToEveryone({
        action: 'battery',
        data: {
            percent,
        },
    });
});

disco.on('GPSFixStateChanged', ({ fixed }) => {
    const isFixed: boolean = fixed === 1;

    localCache.gpsFixed = isFixed;

    sendPacketToEveryone({
        action: 'gps',
        data: {
            isFixed,
        },
    });
});

disco.on('MavlinkPlayErrorStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'event',
        eventId: 'MavlinkPlayErrorStateChanged',
        data,
    });
});

disco.on('MavlinkFilePlayingStateChanged', (data) => {
    sendPacketToEveryone({
        action: 'event',
        eventId: 'MavlinkFilePlayingStateChanged',
        data,
    });
});

let oldSpeed = 0;

let lastSpeedPacket = 0;

disco.on('SpeedChanged', ({ speedX, speedY, speedZ }) => {
    const speed = Math.sqrt(Math.pow(speedX, 2) + Math.pow(speedY, 2) + Math.pow(speedZ, 2));

    if (!lastSpeedPacket || Date.now() - lastSpeedPacket > 1000) {
        sendPacketToEveryone({
            action: 'speed',
            data: oldSpeed - speed,
        });

        lastSpeedPacket = Date.now();
    }

    oldSpeed = speed;
});

disco.on('SensorsStatesListChanged', ({ sensorName, sensorState }) => {
    localCache.sensorStates[sensorName] = sensorState === 1;
});

let lastAltitudePacket = 0;

disco.on('AltitudeChanged', ({ altitude }) => {
    localCache.altitude = altitude;

    if (!lastAltitudePacket || Date.now() - lastAltitudePacket > 1000) {
        sendPacketToEveryone({
            action: 'altitude',
            data: altitude,
        });

        lastAltitudePacket = Date.now();
    }
});

disco.on('NumberOfSatelliteChanged', ({ numberOfSatellite: satellites }) => {
    sendPacketToEveryone({
        action: 'gps',
        data: {
            satellites,
        },
    });
});

let lastPositionPacket = 0;

disco.on('PositionChanged', ({ latitude: lat, longitude: lon }) => {
    if (!lastPositionPacket || Date.now() - lastPositionPacket > 1000) {
        if (lat !== 0 && lon !== 0) {
            sendPacketToEveryone({
                action: 'gps',
                data: {
                    location: {
                        lat,
                        lon,
                    },
                },
            });

            lastPositionPacket = Date.now();
        }
    }
});

disco.on('flyingState', ({ flyingState }) => {
    localCache.flyingState = flyingState;

    sendPacketToEveryone({
        action: 'flyingState',
        data: flyingState,
    });
});

disco.on('AvailabilityStateChanged', ({ AvailabilityState }) => {
    const canTakeOff = AvailabilityState === 1;

    if (Object.values(localCache.sensorStates).filter((sensor) => !sensor).length > 0) {
        logger.error(`Can't take off! ${JSON.stringify(localCache.sensorStates)}`);
    } else {
        localCache.canTakeOff = canTakeOff;

        sendPacketToEveryone({
            action: 'canTakeOff',
            data: canTakeOff,
        });
    }
});

disco.on('VelocityRange', ({ max_tilt: cameraMaxTiltSpeed, max_pan: cameraMaxPanSpeed }) => {
    localCache.cameraMaxTiltSpeed = cameraMaxTiltSpeed;
    localCache.cameraMaxPanSpeed = cameraMaxPanSpeed;

    sendPacketToEveryone({
        action: 'camera',
        data: {
            maxSpeed: {
                maxTiltSpeed: cameraMaxTiltSpeed,
                maxPanSpeed: cameraMaxPanSpeed,
            },
        },
    });
});

disco.on('disconnected', () => {
    logger.info(`Disco disconnected`);

    sendPacketToEveryone({
        action: 'disconnected',
    });

    //process.exit(1);
});

let takeOff = false;

io.on('connection', async (socket) => {
    const address = socket.handshake.address;

    logger.info(`Connection ${socket.id} made from ${address}, creating peer..`);

    const stream = new wrtc.MediaStream();

    socket.authorized = !isFirstAuthorized;

    isFirstAuthorized = true;

    stream.addTrack(videoOutput.track);

    const peer = new Peer({ initiator: true, wrtc });

    clients.push({
        id: socket.id,
        socket,
        peer,
    });

    let pingInterval;

    peer.on('signal', (data) => socket.emit('signal', data));

    peer.on('data', (data) => {
        const packet = JSON.parse(data.toString());

        if (socket.authorized) {
            if (packet.action && packet.action === 'camera') {
                if (packet.data.type === 'absolute') {
                    disco.Camera.moveTo(packet.data.x, packet.data.y);
                } else if (packet.data.type === 'degrees') {
                    disco.Camera.move(packet.data.x, packet.data.y);
                }
            } else if (packet.action && packet.action === 'takeOff') {
                logger.info(`Got take off command`);

                if (takeOff) {
                    logger.info(`Can't take off, user already take off`);
                } else if (localCache.canTakeOff) {
                    const startFlightPlan = true;

                    takeOff = true;

                    if (startFlightPlan) {
                        disco.Mavlink.start('test.mavlink');

                        logger.info(`Starting flight plan`);
                    } else {
                        disco.Piloting.userTakeOff();

                        logger.info(`User taking off`);
                    }
                } else {
                    logger.info(`Can't take off`);
                }
            }
        }

        if (packet.action === 'pong') {
            peer.send(
                JSON.stringify({
                    action: 'latency',
                    data: Date.now() - packet.data.time,
                }),
            );
        }
    });

    peer.on('connect', () => {
        pingInterval = setInterval(() => {
            peer.send(
                JSON.stringify({
                    action: 'ping',
                    data: {
                        time: Date.now(),
                    },
                }),
            );
        }, 1000);

        peer.addStream(stream);

        const initialPackets = [
            {
                action: 'battery',
                data: {
                    percent: disco.navData.battery,
                },
            },
            {
                action: 'gps',
                data: {
                    isFixed: localCache.gpsFixed,
                },
            },
            {
                action: 'altitude',
                data: localCache.altitude,
            },
            {
                action: 'flyingState',
                data: localCache.flyingState,
            },
            {
                action: 'canTakeOff',
                data: localCache.canTakeOff,
            },
        ];

        if (socket.authorized) {
            initialPackets.unshift({
                action: 'authorize',
                data: undefined,
            });
        }

        logger.debug(`New client connected, sending initial packets: ${JSON.stringify(initialPackets)}`);

        for (const packet of initialPackets) {
            peer.send(JSON.stringify(packet));
        }
    });

    socket.peer = peer;

    socket.on('signal', (data) => peer.signal(data));

    socket.on('disconnect', () => {
        logger.info('Socket disconnected, peer destroyed.');

        clearInterval(pingInterval);

        peer.destroy();

        clients = clients.filter((o) => o.id !== socket.id);
    });
});
