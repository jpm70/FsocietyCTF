/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import {
  RotateCcw,
  X,
  Terminal,
  Network,
  Volume2,
  VolumeX,
  FileDown,
  FileText,
  Activity,
  MessageSquare,
  Trophy,
} from 'lucide-react';

type SceneState =
  | 'SCENE_0'
  | 'TRANSITIONING'
  | 'SCENE_1'
  | 'SCENE_2'
  | 'SCENE_3'
  | 'SCENE_4'
  | 'SCENE_5'
  | 'SCENE_6'
  | 'WIN';

export type OperatorRankGrade = 'S+' | 'A' | 'B' | 'C';

export interface OperatorRankResult {
  grade: OperatorRankGrade;
  title: string;
  verdict: string;
  score: number;
  uptimeTierLabel: string;
  uptimeDelta: number;
  failuresPenalty: number;
  metaHackDelta: number;
  metaHackLabel: string;
  stealthDelta: number;
  colorRgb: [number, number, number];
  badgeClass: string;
  pillClass: string;
}

export interface LeaderboardEntry {
  id: string;
  alias: string;
  elapsedSeconds: number;
  rank: OperatorRankGrade;
  score: number;
  failedAttempts: number;
  hintsUsed: number;
  logsCleared: boolean;
  debugAuthUsed: boolean;
  date: string;
}

interface TerminalEntry {
  id: number;
  type: 'cmd' | 'output' | 'success' | 'logdump' | 'top';
  text: string;
}

interface IrcMessage {
  id: number;
  time: string;
  senderRole: 'darlene' | 'mr_robot' | 'romero' | 'elliot' | 'system';
  nick: string;
  text: string;
}

interface ElliotMonologue {
  id: number;
  text: string;
  contextLabel: string;
  isParanoia?: boolean;
}

export type DifficultyLevel = 'EASY' | 'NORMAL' | 'HARD';

export interface DifficultyConfig {
  id: DifficultyLevel;
  shortLabel: string;
  label: string;
  subtitle: string;
  idsMultiplier: number;
  errorIdsIncrement: number;
  errorScorePenalty: number;
  sPlusMaxSeconds: number;
  fastMaxSeconds: number;
  standardMaxSeconds: number;
  sPlusMaxFails: number;
  accentColor: string;
}

export const DIFFICULTY_CONFIG: Record<DifficultyLevel, DifficultyConfig> = {
  EASY: {
    id: 'EASY',
    shortLabel: 'FÁCIL',
    label: 'FÁCIL // SCRIPT KIDDIE',
    subtitle: 'IDS reducido (0.65x), menor penalización por fallo y límites de tiempo amplios.',
    idsMultiplier: 0.65,
    errorIdsIncrement: 12,
    errorScorePenalty: 15,
    sPlusMaxSeconds: 300, // 05:00
    fastMaxSeconds: 450, // 07:30
    standardMaxSeconds: 600, // 10:00
    sPlusMaxFails: 4,
    accentColor: '#00ff41',
  },
  NORMAL: {
    id: 'NORMAL',
    shortLabel: 'NORMAL',
    label: 'NORMAL // RED TEAM',
    subtitle: 'Equilibrio estándar de Fsociety: crecimiento IDS (1.0x) y tiempos oficiales.',
    idsMultiplier: 1.0,
    errorIdsIncrement: 20,
    errorScorePenalty: 25,
    sPlusMaxSeconds: 210, // 03:30
    fastMaxSeconds: 330, // 05:30
    standardMaxSeconds: 480, // 08:00
    sPlusMaxFails: 2,
    accentColor: '#38bdf8',
  },
  HARD: {
    id: 'HARD',
    shortLabel: 'DIFÍCIL',
    label: 'DIFÍCIL // DARK ARMY',
    subtitle: 'SOC Allsafe hiperactivo (1.45x IDS), alta penalización y speedrun extremo.',
    idsMultiplier: 1.45,
    errorIdsIncrement: 30,
    errorScorePenalty: 40,
    sPlusMaxSeconds: 150, // 02:30
    fastMaxSeconds: 240, // 04:00
    standardMaxSeconds: 360, // 06:00
    sPlusMaxFails: 1,
    accentColor: '#ff0033',
  },
};

function formatShortTimeLimit(totalSec: number): string {
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

interface SavedGameData {
  sceneState: SceneState;
  elapsedSeconds: number;
  internalStep: number;
  securityStep: number;
  ceoStep: number;
  camStep: number;
  vaultStep: number;
  currentPrompt: string;
  windowTitle: string;
  totalFailedAttempts?: number;
  hintsUsed?: number;
  logsCleared?: boolean;
  debugAuthUsed?: boolean;
  playerScore?: number;
  threatLevel?: number;
  operatorSpoofedMac?: string;
  commandHistory?: string[];
  isGodModeUnlocked?: boolean;
  difficulty?: DifficultyLevel;
}

const STORAGE_KEY = 'fsociety_ctf_save';
const LEADERBOARD_STORAGE_KEY = 'fsociety_ctf_leaderboard';
const MUTE_STORAGE_KEY = 'fsociety_ctf_muted';
const VOLUME_STORAGE_KEY = 'fsociety_ctf_volume';
const DIFFICULTY_STORAGE_KEY = 'fsociety_ctf_difficulty';
const ASSET_BASE = import.meta.env.BASE_URL;
const FSOCIETY_REPORT_LOGO_PATH = `${ASSET_BASE}assets/img/fsociety_emblem.jpg`;
const HOUSE_LOGO_PATH = `${ASSET_BASE}assets/img/fantasma.png`;
const HOUSE_URL = 'https://www.unfantasmaenelsistema.com/';
const REPO_URL = 'https://github.com/unfantasmaenelsistema/FsocietyCTF';

// Atajos de desarrollo (saltar de escena): solo con ?dev en la URL
const IS_DEV_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');

const DEFAULT_BENCHMARK_LEADERBOARD: LeaderboardEntry[] = [
  {
    id: 'bench-mr-robot',
    alias: 'mr_robot',
    elapsedSeconds: 195,
    rank: 'S+',
    score: 945,
    failedAttempts: 0,
    hintsUsed: 0,
    logsCleared: true,
    debugAuthUsed: false,
    date: '09/05/2015',
  },
  {
    id: 'bench-darlene',
    alias: 'd0loresH4ze',
    elapsedSeconds: 260,
    rank: 'A',
    score: 798,
    failedAttempts: 1,
    hintsUsed: 0,
    logsCleared: false,
    debugAuthUsed: false,
    date: '09/05/2015',
  },
  {
    id: 'bench-romero',
    alias: 'ph4nt0m_romero',
    elapsedSeconds: 385,
    rank: 'B',
    score: 630,
    failedAttempts: 2,
    hintsUsed: 1,
    logsCleared: false,
    debugAuthUsed: false,
    date: '09/05/2015',
  },
];

// Cálculo de Rango Final del Operador (S+, A, B, C) basado en UPTIME, failedAttempts, dificultad y si se usaron Meta-Hacks (debug_auth)
function calculateOperatorRank(params: {
  elapsedSeconds: number;
  failedAttempts: number;
  hintsUsed: number;
  logsCleared: boolean;
  debugAuthUsed: boolean;
  liveScore?: number;
  difficulty?: DifficultyLevel;
}): OperatorRankResult {
  const {
    elapsedSeconds,
    failedAttempts,
    hintsUsed,
    logsCleared,
    debugAuthUsed,
    difficulty = 'NORMAL',
  } = params;
  const diffCfg = DIFFICULTY_CONFIG[difficulty] ?? DIFFICULTY_CONFIG.NORMAL;
  const sPlusLimitStr = formatShortTimeLimit(diffCfg.sPlusMaxSeconds);
  const fastLimitStr = formatShortTimeLimit(diffCfg.fastMaxSeconds);
  const stdLimitStr = formatShortTimeLimit(diffCfg.standardMaxSeconds);

  // 1. Evaluación del factor UPTIME (Velocidad de intrusión ajustada por el selector de dificultad)
  let uptimeDelta = 0;
  let uptimeTierLabel = `ESTANDAR (<${stdLimitStr})`;
  if (elapsedSeconds <= diffCfg.sPlusMaxSeconds) {
    uptimeDelta = 150;
    uptimeTierLabel = `SPEEDRUN ELITE (<${sPlusLimitStr})`;
  } else if (elapsedSeconds <= diffCfg.fastMaxSeconds) {
    uptimeDelta = 75;
    uptimeTierLabel = `OPERACION RAPIDA (<${fastLimitStr})`;
  } else if (elapsedSeconds <= diffCfg.standardMaxSeconds) {
    uptimeDelta = 0;
    uptimeTierLabel = `RITMO OPERATIVO (<${stdLimitStr})`;
  } else {
    const overSeconds = elapsedSeconds - diffCfg.standardMaxSeconds;
    uptimeDelta = -Math.min(280, Math.floor(overSeconds / 2));
    uptimeTierLabel = 'EXPOSICION PROLONGADA';
  }

  // 2. Evaluación del factor failedAttempts (Penalización ajustada por dificultad: -15 / -25 / -40 PTS por fallo)
  const failuresPenalty = -(failedAttempts * diffCfg.errorScorePenalty);

  // 3. Evaluación del factor Meta-Hacks (DevTools F12 / debug_auth: +120 PTS por explotar el backdoor oculto)
  const metaHackDelta = debugAuthUsed ? 120 : 0;
  const metaHackLabel = debugAuthUsed
    ? 'EXPLOTADO (+120 PTS // ROOT F12)'
    : 'NO USADO (INTRUSION MANUAL)';

  // 4. Factores complementarios: Borrado forense de logs (+130 PTS) y Pistas (-100 PTS)
  const stealthDelta = logsCleared ? 130 : 0;
  const hintsPenalty = -(hintsUsed * 100);

  // Puntuación base de misión completada (750 PTS) + modificadores de rendimiento
  const rawScore = 750 + uptimeDelta + failuresPenalty + metaHackDelta + stealthDelta + hintsPenalty;
  const clampedScore = Math.max(100, Math.min(1000, rawScore));

  // Determinación del Rango (S+, A, B, C) combinando Puntuación, UPTIME, failedAttempts y límites de dificultad
  const isSPlusEligible =
    clampedScore >= 850 &&
    failedAttempts <= diffCfg.sPlusMaxFails &&
    (elapsedSeconds <= diffCfg.fastMaxSeconds || debugAuthUsed || logsCleared);

  if (isSPlusEligible) {
    return {
      grade: 'S+',
      title: debugAuthUsed
        ? 'ZERO-DAY ARCHITECT // META-HACKER'
        : 'MASTER OF FSOCIETY // ZERO-TRACE',
      verdict: debugAuthUsed
        ? 'Intrusión implacable: explotaste el backdoor de DevTools (debug_auth) y vulneraste ECorp en tiempo récord.'
        : 'Ejecución quirúrgica sin apenas errores y con velocidad de élite. ECorp ni siquiera supo qué les golpeó.',
      score: clampedScore,
      uptimeTierLabel,
      uptimeDelta,
      failuresPenalty,
      metaHackDelta,
      metaHackLabel,
      stealthDelta,
      colorRgb: [0, 255, 65],
      badgeClass: 'rank-s-plus',
      pillClass: 's-plus',
    };
  }

  if (clampedScore >= 680 && failedAttempts <= 6) {
    return {
      grade: 'A',
      title: debugAuthUsed
        ? 'SENIOR EXPLOIT DEVELOPER'
        : 'SENIOR PENETRATION TESTER',
      verdict:
        'Operación de alto nivel técnico. Mantuviste bajo el índice de fallos y superaste la bóveda con solvencia.',
      score: clampedScore,
      uptimeTierLabel,
      uptimeDelta,
      failuresPenalty,
      metaHackDelta,
      metaHackLabel,
      stealthDelta,
      colorRgb: [56, 189, 248],
      badgeClass: 'rank-a',
      pillClass: 'a',
    };
  }

  if (clampedScore >= 480) {
    return {
      grade: 'B',
      title: 'RED TEAM FIELD OPERATIVE',
      verdict:
        'Misión cumplida, aunque el tiempo en red o los comandos fallidos dejaron alertas en el SOC de Allsafe.',
      score: clampedScore,
      uptimeTierLabel,
      uptimeDelta,
      failuresPenalty,
      metaHackDelta,
      metaHackLabel,
      stealthDelta,
      colorRgb: [255, 189, 46],
      badgeClass: 'rank-b',
      pillClass: 'b',
    };
  }

  return {
    grade: 'C',
    title: 'EXPOSED INFILTRATOR',
    verdict:
      'Extrajiste el objetivo por los pelos, pero el exceso de fallos y demora activó todas las alarmas forenses.',
    score: clampedScore,
    uptimeTierLabel,
    uptimeDelta,
    failuresPenalty,
    metaHackDelta,
    metaHackLabel,
    stealthDelta,
    colorRgb: [255, 0, 51],
    badgeClass: 'rank-c',
    pillClass: 'c',
  };
}

// Hash SHA256 determinista de verificación
function computeVerificationHash(
  alias: string,
  totalTimeStr: string,
  rank: OperatorRankGrade
): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  const seedStr = `${alias}:${totalTimeStr}:${rank}:FSOCIETY_59`;
  for (let i = 0; i < seedStr.length; i++) {
    const code = seedStr.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i * 31);
    h2 = Math.imul(h2, 0x1000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return `SHA256:${part1}${part2}E9F4A10C`;
}

// Generar matriz booleana QR vectorial (ISO/IEC 18004) para jsPDF y vista previa SVG
function buildQrMatrix(payload: string): boolean[][] {
  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const matrix: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) {
        row.push(Boolean(qr.modules.get(r, c)));
      }
      matrix.push(row);
    }
    return matrix;
  } catch {
    // Fallback determinista 21x21 si ocurriera algún error
    const size = 21;
    return Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (__, c) => (r + c) % 2 === 0)
    );
  }
}


const INITIAL_IRC_MESSAGES: IrcMessage[] = [
  {
    id: 1,
    time: '01:00',
    senderRole: 'system',
    nick: '***',
    text: 'Conectado a irc.colo-solutions.net:6697 (TLSv1.3) — Canal #fsociety-op',
  },
  {
    id: 2,
    time: '01:00',
    senderRole: 'darlene',
    nick: '@d0loresH4ze',
    text: 'Elliot, ya estás dentro del relay. El objetivo inicial es ecorp.com (/login.php?id=1).',
  },
  {
    id: 3,
    time: '01:00',
    senderRole: 'romero',
    nick: '+ph4nt0m_romero',
    text: 'Mantén el ruido bajo, chico. El SOC de Allsafe monitoriza los escaneos en tiempo real.',
  },
  {
    id: 4,
    time: '01:01',
    senderRole: 'mr_robot',
    nick: '@mr_robot',
    text: 'Sin dudas hoy, hijo. Quema su imperio desde los cimientos.',
  },
];

const SCENE_MONOLOGUES: Record<string, { label: string; text: string }> = {
  SCENE_1: {
    label: 'FASE 01 // BRECHA PERIMETRAL',
    text: '“Hola, amigo. Sé que estás ahí escuchando. ECorp cree que su fortaleza es impenetrable, pero dejaron la puerta abierta en un simple parámetro SQL...”',
  },
  SCENE_2: {
    label: 'FASE 02 // SUBRED INTERNA',
    text: '“Estamos dentro de su red corporativa. Gastan millones en firewalls perimetrales y olvidan una impresora HP con acceso FTP anónimo. Siempre es un descuido humano.”',
  },
  SCENE_3: {
    label: 'FASE 03 // SERVIDOR DE SEGURIDAD',
    text: '“El nodo de control físico. Confían ciegamente en tarjetas plásticas MIFARE como si un UID hexadecimal no pudiera copiarse en segundos...”',
  },
  SCENE_4: {
    label: 'FASE 04 // ESTACIÓN DEL CEO',
    text: '“La subred ejecutiva de Tyrell Wellick. Se creen dioses intocables jugando con nuestras deudas, pero todo su poder cabe en un diccionario de fuerza bruta.”',
  },
  SCENE_5: {
    label: 'FASE 05 // INCURSIÓN EXTERIOR',
    text: '“Hace frío aquí fuera. El guardia ni siquiera sospecha que el punto de acceso WiFi al que acaba de conectarse es el nuestro. El control es una ilusión.”',
  },
  SCENE_6: {
    label: 'FASE 06 // CÁMARA ACORAZADA',
    text: '“La bóveda de ECorp. Un cable serie RS-232 conectado a /dev/ttyUSB0. Todo su dinero, todos sus secretos... reducidos a siete dígitos.”',
  },
  WIN: {
    label: 'OPERACIÓN COMPLETADA // 5/9',
    text: '“Lo hicimos, amigo. El pendrive está en nuestras manos y no queda huella. ECorp ha caído... ¿Por qué siento que esto es solo el principio?”',
  },
};

interface SnifferPacket {
  id: string;
  time: string;
  src: string;
  dst: string;
  proto: string;
  info: string;
  isEvilPortal?: boolean;
  hexDump: string;
}

const SNIFFER_PACKETS: SnifferPacket[] = [
  {
    id: '#01',
    time: '0.000s',
    src: '10.0.0.10',
    dst: '198.51.100.42',
    proto: 'HTTP',
    info: "GET /login.php?id=1' OR '1'='1 --dbs",
    hexDump: [
      '0x0000:  45 00 00 6c 1c 46 40 00  40 06 b1 e6 0a 00 00 0a   E..l.F@.@.......',
      '0x0010:  c6 33 64 2a c8 14 00 50  39 a2 1f 01 00 00 00 00   .3d*...P9.......',
      '0x0020:  47 45 54 20 2f 6c 6f 67  69 6e 2e 70 68 70 3f 69   GET /login.php?i',
      '0x0030:  64 3d 31 27 20 55 4e 49  4f 4e 20 53 45 4c 45 43   d=1\' UNION SELEC',
      '0x0040:  54 20 75 73 65 72 2c 70  61 73 73 20 46 52 4f 4d   T user,pass FROM',
      '0x0050:  20 65 63 6f 72 70 5f 64  62 2e 75 73 65 72 73 20    ecorp_db.users ',
    ].join('\n'),
  },
  {
    id: '#02',
    time: '1.412s',
    src: '10.0.0.15',
    dst: '10.0.0.10',
    proto: 'FTP-DATA',
    info: 'RETR config_backup.bak (print-admin%P@ssw0rd_pr1nt)',
    hexDump: [
      '0x0000:  45 00 00 78 4a 11 40 00  40 06 82 10 0a 00 00 0f   E..xJ.@.@.......',
      '0x0010:  0a 00 00 0a 00 14 d4 31  7b 19 02 a0 88 12 4f 11   .......1{.....O.',
      '0x0020:  73 6d 62 5f 75 73 65 72  3d 70 72 69 6e 74 2d 61   smb_user=print-a',
      '0x0030:  64 6d 69 6e 0a 73 6d 62  5f 70 61 73 73 3d 50 40   dmin.smb_pass=P@',
      '0x0040:  73 73 77 30 72 64 5f 70  72 31 6e 74 0a 00 00 00   ssw0rd_pr1nt....',
    ].join('\n'),
  },
  {
    id: '#03',
    time: '3.089s',
    src: '10.0.0.50',
    dst: '10.0.0.10',
    proto: 'SMB2',
    info: 'READ Response File: access_records.csv (UID 047AB219C855)',
    hexDump: [
      '0x0000:  fe 53 4d 42 40 00 01 00  00 00 00 00 08 00 01 00   .SMB@...........',
      '0x0010:  43 45 4f 5f 54 79 72 65  6c 6c 2c 20 30 34 3a 37   CEO_Tyrell, 04:7',
      '0x0020:  41 3a 42 32 3a 31 39 3a  43 38 3a 35 35 2c 20 41   A:B2:19:C8:55, A',
      '0x0030:  43 43 45 53 53 5f 47 52  41 4e 54 45 44 0d 0a 00   CCESS_GRANTED...',
    ].join('\n'),
  },
  {
    id: '#04',
    time: '5.820s',
    src: '00:14:22:01:23:45',
    dst: 'Broadcast',
    proto: '802.11',
    info: 'Deauthentication (wlan0mon -> BSSID ECorp_Security)',
    isEvilPortal: true,
    hexDump: [
      '0x0000:  c0 00 3a 01 ff ff ff ff  ff ff 00 14 22 01 23 45   ..:.........".#E',
      '0x0010:  00 14 22 01 23 45 70 4a  07 00 00 00 45 43 6f 72   ..".#EpJ....ECor',
      '0x0020:  70 5f 53 65 63 75 72 69  74 79 00 00 00 00 00 00   p_Security......',
    ].join('\n'),
  },
  {
    id: '#05',
    time: '6.304s',
    src: '192.168.99.44',
    dst: '192.168.99.1',
    proto: 'HTTP',
    info: 'POST /evil_portal/auth.php [CAPTURED: guard_01 / Al4rm_0ff_99]',
    isEvilPortal: true,
    hexDump: [
      '0x0000:  50 4f 53 54 20 2f 65 76  69 6c 5f 70 6f 72 74 61   POST /evil_porta',
      '0x0010:  6c 2f 61 75 74 68 2e 70  68 70 20 48 54 54 50 2f   l/auth.php HTTP/',
      '0x0020:  31 2e 31 0d 0a 48 6f 73  74 3a 20 31 39 32 2e 31   1.1..Host: 192.1',
      '0x0030:  36 38 2e 39 39 2e 31 30  0d 0a 0d 0a 75 73 65 72   68.99.10....user',
      '0x0040:  3d 67 75 61 72 64 5f 30  31 26 70 61 73 73 3d 41   =guard_01&pass=A',
      '0x0050:  6c 34 72 6d 5f 30 66 66  5f 39 39 26 73 73 69 64   l4rm_0ff_99&ssid',
      '0x0060:  3d 45 43 6f 72 70 5f 53  65 63 75 72 69 74 79 00   =ECorp_Security.',
    ].join('\n'),
  },
  {
    id: '#06',
    time: '8.115s',
    src: '192.168.99.5',
    dst: '192.168.99.10',
    proto: 'HTTP',
    info: 'POST /api/alarm/disable (Authorization: Basic Z3VhcmRfMDE6...)',
    isEvilPortal: true,
    hexDump: [
      '0x0000:  50 4f 53 54 20 2f 61 70  69 2f 61 6c 61 72 6d 2f   POST /api/alarm/',
      '0x0010:  64 69 73 61 62 6c 65 20  48 54 54 50 2f 31 2e 31   disable HTTP/1.1',
      '0x0020:  0d 0a 41 75 74 68 6f 72  69 7a 61 74 69 6f 6e 3a   ..Authorization:',
      '0x0030:  20 67 75 61 72 64 5f 30  31 3a 41 6c 34 72 6d 5f    guard_01:Al4rm_',
      '0x0040:  30 66 66 5f 39 39 0d 0a  7b 22 73 74 61 74 75 73   0ff_99..{"status',
      '0x0050:  22 3a 22 6f 66 66 6c 69  6e 65 22 7d 00 00 00 00   ":"offline"}....',
    ].join('\n'),
  },
];

const ECORP_SYSTEM_ACCESS_LOGS = [
  '2026-11-09T23:41:02.114Z [SIEM-CORE] INFO  src=10.0.0.1    dst=10.0.0.255  proto=ARP   msg="Gratuitous ARP broadcast from ECorp-Internal-GW"',
  '2026-11-09T23:42:18.409Z [WEB-DMZ01] WARN  src=185.220.101.7 dst=198.51.100.42 proto=HTTP  msg="GET /login.php?id=1\' OR \'1\'=\'1 — SQLi heuristic triggered (WAF in MONITOR_ONLY mode)"',
  '2026-11-09T23:43:05.882Z [MYSQL-DB]  ALERT src=127.0.0.1   dst=127.0.0.1:3306 user=www-data msg="Full table scan on ecorp_db.users (1 row returned: admin)"',
  '2026-11-09T23:44:11.003Z [AUTH-PAM]  INFO  src=10.0.0.10   dst=10.0.0.15   user=anonymous msg="vsFTPd 3.0.3: Anonymous FTP session opened on HP-LaserJet-Pro spooler"',
  '2026-11-09T23:44:29.517Z [FTP-SPOOL] WARN  src=10.0.0.10   dst=10.0.0.15   file="config_backup.bak" msg="RETR config_backup.bak (2048 bytes) — Cleartext SMB service account exposed"',
  '2026-11-09T23:45:02.190Z [SYSADMIN]  NOTE  src=10.0.0.10   user=lloyd_chung msg="TODO: Remove print-admin%P@ssw0rd_pr1nt from printer FTP root before Allsafe Q4 audit"',
  '2026-11-09T23:46:40.771Z [SMB-SEC01] INFO  src=10.0.0.15   dst=10.0.0.50:445 user=print-admin msg="IPC$ and Security_Logs share enumerated from internal subnet"',
  '2026-11-09T23:47:12.339Z [SMB-SEC01] WARN  src=10.0.0.15   dst=10.0.0.50:445 share="Security_Logs" msg="File read: \\access_records.csv (2048 bytes) by user print-admin"',
  '2026-11-09T23:48:04.612Z [RFID-CTRL] INFO  door="EXEC_ELEVATOR_B2" uid="04:7A:B2:19:C8:55" holder="CEO_Tyrell" status="ACCESS_GRANTED"',
  '2026-11-09T23:48:55.904Z [RFID-CTRL] CRIT  door="SERVER_VAULT_VESTIBULE" uid="04:7A:B2:19:C8:55" msg="Duplicate MIFARE Classic 1K Block-0 UID replay detected within 51s window"',
  '2026-11-09T23:50:01.118Z [ALLSAFE]   WARN  sensor="IDS-NY-04" analyst="gideon_goddard" msg="Anomalous East-West lateral movement across VLAN 10 -> VLAN 50 -> VLAN 100"',
  '2026-11-09T23:51:19.440Z [SSHD-CEO]  ALERT src=10.0.0.50   dst=10.0.0.100:22 user=ceo msg="Failed password for ceo from 10.0.0.50 port 51922 ssh2 (Hydra parallel tasks=16)"',
  '2026-11-09T23:51:20.008Z [SSHD-CEO]  ALERT src=10.0.0.50   dst=10.0.0.100:22 user=ceo msg="Failed password for ceo from 10.0.0.50 port 51924 ssh2 (attempt: 123456)"',
  '2026-11-09T23:51:20.619Z [SSHD-CEO]  ALERT src=10.0.0.50   dst=10.0.0.100:22 user=ceo msg="Failed password for ceo from 10.0.0.50 port 51928 ssh2 (attempt: ecorp_admin)"',
  '2026-11-09T23:51:21.205Z [SSHD-CEO]  CRIT  src=10.0.0.50   dst=10.0.0.100:22 user=ceo msg="Accepted password for ceo from 10.0.0.50 port 51930 ssh2 ( dictionary match: godmode )"',
  '2026-11-09T23:52:09.731Z [AUDIT-CEO] INFO  host=ecorp-desktop user=ceo tty=pts/0 cmd="cat /home/ceo/safe_code.b64" payload="NzM1NTYwOA=="',
  '2026-11-09T23:52:44.890Z [AUDIT-CEO] WARN  host=ecorp-desktop user=ceo tty=pts/0 cmd="cat /home/ceo/fsociety00.dat" msg="Unauthorized binary marker detected in sector 4"',
  '2026-11-09T23:53:30.102Z [DARK-ARMY] TRACE relay="218.92.0.194" target="ecorp-backup-tape-09" msg="Stage-2 firmware implant beacon ACK (whiterose_clock_sync=OK)"',
  '2026-11-09T23:54:15.553Z [WIDS-EXT]  CRIT  iface=wlan0mon bssid="00:14:22:01:23:45" ssid="ECorp_Security" msg="Rogue Evil Twin AP & IEEE 802.11 deauth flood detected near loading dock"',
  '2026-11-09T23:54:48.920Z [CAPTIVE]   WARN  client_mac="00:14:22:01:23:45" user="guard_01" msg="Basic-Auth token intercepted over unencrypted HTTP captive portal"',
  '2026-11-09T23:55:12.667Z [ALARM-API] CRIT  src=192.168.99.5 dst=192.168.99.10 endpoint="POST /api/alarm/disable" user="guard_01" msg="Perimeter alarm disarmed remotely"',
  '2026-11-09T23:56:03.241Z [IOT-CAM01] WARN  src=192.168.99.5 dst=192.168.99.20:23 proto=TELNET user=root msg="Default credential login (root:12345) on Cam-OS v2.14"',
  '2026-11-09T23:56:29.884Z [IOT-CAM01] CRIT  host=cam-01 pid=412 daemon="streamd" msg="RTSP stream :554 terminated via SIGTERM (service camera stop) — Corridor B3 blind"',
  '2026-11-09T23:57:41.009Z [VAULT-TTY] ALERT dev="/dev/ttyUSB0" baud=9600 proto=RS232 msg="Physical maintenance serial cable attached to VaultOS v1.0 controller"',
  '2026-11-09T23:58:02.999Z [VAULT-TTY] CRIT  dev="/dev/ttyUSB0" override_pin="7355608" msg="MASTER OVERRIDE ACCEPTED — Solenoid lock disengaged, pendulum bolt retracted"',
  '2026-11-09T23:58:15.000Z [FSOCIETY]  OK    node="CONEY_ISLAND_ARCADE" operator="elliot" msg="End-of-log dump. Remember: control is an illusion."',
].join('\n');

const INITIAL_TERMINAL_LOG: TerminalEntry[] = [
  {
    id: 1,
    type: 'output',
    text: 'Kali GNU/Linux Rolling [fsociety-node01 tty1]\nObjetivo detectado: ecorp.com (Portal Corporativo ECorp)\nEscribe "help" para ver los comandos disponibles.',
  },
];

const WIN_VICTORY_TEXT = 'PENDRIVE ASEGURADO.\nECorp HA CAÍDO.\nGRACIAS, AMIGO.';

function formatUptime(totalSeconds: number): string {
  const hrs = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSeconds % 60).padStart(2, '0');
  return `UPTIME: ${hrs}:${mins}:${secs}`;
}

const DEBUG_SESSION_KEY = 'ecorp_debug_session';
const DEBUG_SESSION_HASH = 'e9f4a8c2d1b7_fsociety_root';
const EMERGENCY_B64_KEY = 'dXNlcl9iYWNrdXA='; // Decodifica a "user_backup"

export default function App() {
  const [sceneState, setSceneState] = useState<SceneState>('SCENE_0');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [playerScore, setPlayerScore] = useState<number>(0);
  const [scoreDeltaToast, setScoreDeltaToast] = useState<{
    id: number;
    delta: number;
    reason: string;
  } | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [totalFailedAttempts, setTotalFailedAttempts] = useState<number>(0);
  const [hintsUsed, setHintsUsed] = useState<number>(0);
  const [debugAuthUsed, setDebugAuthUsed] = useState<boolean>(false);
  const [internalStep, setInternalStep] = useState<number>(0);
  const [securityStep, setSecurityStep] = useState<number>(0);
  const [ceoStep, setCeoStep] = useState<number>(0);
  const [exteriorStep, setExteriorStep] = useState<number>(0);
  const [vaultStep, setVaultStep] = useState<number>(0);
  const [currentPrompt, setCurrentPrompt] = useState<string>('elliot@fsociety:~#');
  const [windowTitle, setWindowTitle] = useState<string>('elliot@fsociety:~');

  const [isMissionModalOpen, setIsMissionModalOpen] = useState<boolean>(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [hackerAliasInput, setHackerAliasInput] = useState<string>('Elliot_Alderson');
  const [isStartLeaderboardOpen, setIsStartLeaderboardOpen] = useState<boolean>(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as LeaderboardEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, 5);
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_BENCHMARK_LEADERBOARD;
  });
  const useBackgroundImg = true;

  // Estado de silencio (Mute/Unmute) y Volumen Maestro (0.0 a 1.0) persistidos en localStorage
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [masterVolume, setMasterVolume] = useState<number>(() => {
    try {
      const savedVol = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      if (savedVol !== null) {
        const parsed = parseFloat(savedVol);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          return parsed;
        }
      }
    } catch {
      // Fallback
    }
    return 0.3;
  });

  // Estado de la Terminal Flotante (#kali-terminal), Historial de Comandos (Flechas ↑/↓) y Bloqueo de Ejecución
  const [terminalLogs, setTerminalLogs] = useState<TerminalEntry[]>(INITIAL_TERMINAL_LOG);
  const [commandInput, setCommandInput] = useState<string>('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [historyDraftInput, setHistoryDraftInput] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [vfsSubdir, setVfsSubdir] = useState<string>('');

  const [termPos, setTermPos] = useState<{ x: number; y: number }>({ x: 14, y: 76 });
  const [termSize, setTermSize] = useState<{ w: number; h: number }>({ w: 760, h: 520 });
  const [sidePanel, setSidePanel] = useState<{ w: number; ircH: number }>({ w: 390, ircH: 295 });
  const topbarRef = useRef<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Estado de la segunda ventana flotante: Network Topology (#network-map)
  const [isNetworkMapOpen, setIsNetworkMapOpen] = useState<boolean>(true);
  const [isNetworkMapMinimized, setIsNetworkMapMinimized] = useState<boolean>(false);
  const [netMapPos, setNetMapPos] = useState<{ x: number; y: number }>({ x: 840, y: 88 });
  const [isDraggingMap, setIsDraggingMap] = useState<boolean>(false);

  // Nivel de dificultad seleccionado en la pantalla de inicio (FÁCIL, NORMAL, DIFÍCIL)
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() => {
    try {
      const savedDiff = window.localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (savedDiff === 'EASY' || savedDiff === 'NORMAL' || savedDiff === 'HARD') {
        return savedDiff;
      }
    } catch {
      // Fallback
    }
    return 'NORMAL';
  });

  // Estado de Ciberseguridad / Blue Team (Alerta de Intrusión IDS 0-100%, Huella Forense y Mini-Wireshark)
  const [threatLevel, setThreatLevel] = useState<number>(0);
  const [idsDeltaToast, setIdsDeltaToast] = useState<{
    id: number;
    delta: number;
    reason: string;
    isReset?: boolean;
  } | null>(null);
  const [operatorSpoofedMac, setOperatorSpoofedMac] = useState<string>('00:C0:CA:82:1F:09');
  const [logsCleared, setLogsCleared] = useState<boolean>(false);
  const [isGodModeUnlocked, setIsGodModeUnlocked] = useState<boolean>(false);
  const [godModeSecondsLeft, setGodModeSecondsLeft] = useState<number>(0);
  const [isSnifferOpen, setIsSnifferOpen] = useState<boolean>(false);
  const [isSnifferMinimized, setIsSnifferMinimized] = useState<boolean>(false);
  const [snifferPos, setSnifferPos] = useState<{ x: number; y: number }>({ x: 760, y: 340 });
  const [isDraggingSniffer, setIsDraggingSniffer] = useState<boolean>(false);
  const [selectedPacketIdx, setSelectedPacketIdx] = useState<number>(4);

  // Estado del Motor de Paranoia (Desenfoque temporal y línea fantasma efímera)
  const [isTerminalBlurred, setIsTerminalBlurred] = useState<boolean>(false);
  const [phantomHallucination, setPhantomHallucination] = useState<string | null>(null);

  // Estado del perfil de color de la terminal ('theme <name>': Matrix, Dracula, Monokai)
  const [terminalTheme, setTerminalTheme] = useState<'matrix' | 'dracula' | 'monokai'>(() => {
    try {
      const savedTheme = window.localStorage.getItem('fsociety_terminal_theme_v1');
      if (savedTheme === 'matrix' || savedTheme === 'dracula' || savedTheme === 'monokai') {
        return savedTheme;
      }
    } catch {
      // Ignorar errores de almacenamiento
    }
    return 'matrix';
  });

  // Estado del monitor de procesos 'top' en tiempo real (CPU, RAM, Núcleos, Red, Disco e Historial para ECorp)
  const [topSortBy, setTopSortBy] = useState<'cpu' | 'mem' | 'pid' | 'time'>('cpu');
  const [topUserFilter, setTopUserFilter] = useState<string>('ALL');
  const [topPaused, setTopPaused] = useState<boolean>(false);
  const [topSelectedPid, setTopSelectedPid] = useState<number>(1337);
  const [topTelemetry, setTopTelemetry] = useState<{
    secCpu: number;
    secMem: number;
    secResMb: number;
    siemCpu: number;
    siemMem: number;
    nodeCpu: number;
    nodeMem: number;
    dbCpu: number;
    dbMem: number;
    logCpu: number;
    logMem: number;
    syncCpu: number;
    syncMem: number;
    camCpu: number;
    camMem: number;
    sysCpu: number;
    cores: [number, number, number, number];
    swapUsedMb: number;
    cacheMemMb: number;
    netRxKbps: number;
    netTxKbps: number;
    diskReadMb: number;
    diskWriteMb: number;
    cpuHistory: number[];
    memHistory: number[];
    load1: string;
    load5: string;
    load15: string;
    tickCount: number;
    tamperSpikeUntil: number;
  }>({
    secCpu: 34.8,
    secMem: 21.4,
    secResMb: 3506,
    siemCpu: 8.6,
    siemMem: 9.2,
    nodeCpu: 6.4,
    nodeMem: 7.5,
    dbCpu: 5.2,
    dbMem: 11.4,
    logCpu: 3.1,
    logMem: 4.2,
    syncCpu: 2.4,
    syncMem: 3.8,
    camCpu: 4.5,
    camMem: 2.9,
    sysCpu: 4.1,
    cores: [64.2, 52.8, 41.5, 36.9],
    swapUsedMb: 642,
    cacheMemMb: 2180,
    netRxKbps: 1420,
    netTxKbps: 890,
    diskReadMb: 18.4,
    diskWriteMb: 12.7,
    cpuHistory: [48, 52, 49, 55, 61, 58, 53, 57, 63, 59, 54, 60, 65, 62, 58, 61, 66, 63, 59, 64],
    memHistory: [54, 54, 55, 55, 56, 56, 55, 56, 57, 57, 56, 57, 58, 58, 57, 58, 59, 58, 58, 60],
    load1: '1.84',
    load5: '1.42',
    load15: '1.09',
    tickCount: 0,
    tamperSpikeUntil: 0,
  });

  // Estado de Narrativa Dinámica: Chat IRC Flotante (#fsociety-irc) y Monólogo Interior de Elliot (#elliot-monologue)
  const [ircMessages, setIrcMessages] = useState<IrcMessage[]>(INITIAL_IRC_MESSAGES);
  const [ircInput, setIrcInput] = useState<string>('');
  const [isIrcOpen, setIsIrcOpen] = useState<boolean>(true);
  const [isIrcMinimized, setIsIrcMinimized] = useState<boolean>(false);
  const [isIrcDocked, setIsIrcDocked] = useState<boolean>(false);
  const [ircPos, setIrcPos] = useState<{ x: number; y: number }>({ x: 840, y: 390 });
  const [isDraggingIrc, setIsDraggingIrc] = useState<boolean>(false);
  const [unreadIrcCount, setUnreadIrcCount] = useState<number>(0);

  const [activeMonologue, setActiveMonologue] = useState<ElliotMonologue | null>(null);
  const [isVoiceMonologueEnabled, setIsVoiceMonologueEnabled] = useState<boolean>(true);

  const dragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });
  const mapDragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });
  const snifferDragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });
  const ircDragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const netMapRef = useRef<HTMLDivElement | null>(null);
  const d3TopologySvgRef = useRef<SVGSVGElement | null>(null);
  const [selectedTopologyNodeId, setSelectedTopologyNodeId] = useState<string>('node-web');
  const snifferRef = useRef<HTMLDivElement | null>(null);
  const ircRef = useRef<HTMLDivElement | null>(null);
  const ircListRef = useRef<HTMLDivElement | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const execIntervalRef = useRef<number | null>(null);
  const execTimeoutRef = useRef<number | null>(null);
  const paranoiaTimerRef = useRef<number | null>(null);
  const monologueTimeoutRef = useRef<number | null>(null);
  const scoreDeltaTimerRef = useRef<number | null>(null);
  const idsDeltaTimerRef = useRef<number | null>(null);
  const threatLevelRef = useRef<number>(0);
  const godModeRemainingRef = useRef<number>(0);
  const difficultyRef = useRef<DifficultyLevel>(difficulty);
  const awardedActionsRef = useRef<Set<string>>(new Set());
  const hasLoadedSaveRef = useRef<boolean>(false);
  const logoDataUrlRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    threatLevelRef.current = threatLevel;
  }, [threatLevel]);

  useEffect(() => {
    godModeRemainingRef.current = godModeSecondsLeft;
  }, [godModeSecondsLeft]);

  useEffect(() => {
    difficultyRef.current = difficulty;
    try {
      window.localStorage.setItem(DIFFICULTY_STORAGE_KEY, difficulty);
    } catch {
      // Ignore storage errors
    }
  }, [difficulty]);

  // Cuenta regresiva de 30 segundos para el comando oculto 'god_mode' (Inmunidad IDS en escaneos y comandos)
  useEffect(() => {
    if (godModeSecondsLeft <= 0) {
      return;
    }

    const timerId = window.setInterval(() => {
      setGodModeSecondsLeft((prev) => {
        if (prev <= 1) {
          godModeRemainingRef.current = 0;
          setTerminalLogs((logs) => [
            ...logs,
            {
              id: Date.now() + Math.floor(Math.random() * 500),
              type: 'output',
              text: "[SISTEMA] El escudo de 30s de 'god_mode' ha expirado. Los sensores IDS de Allsafe vuelven a registrar ruido de red.",
            },
          ]);
          return 0;
        }
        const nextVal = prev - 1;
        godModeRemainingRef.current = nextVal;
        return nextVal;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [godModeSecondsLeft > 0]);

  // Actualizar puntuación en pantalla (Score) al realizar acciones exitosas (+) o cometer errores (-)
  const updatePlayerScore = (delta: number, reason: string, actionKey?: string) => {
    if (delta > 0) {
      playSuccessSfx();
    }
    if (actionKey) {
      if (awardedActionsRef.current.has(actionKey)) {
        return;
      }
      awardedActionsRef.current.add(actionKey);
    }

    setPlayerScore((prev) => Math.max(0, prev + delta));
    if (scoreDeltaTimerRef.current) {
      window.clearTimeout(scoreDeltaTimerRef.current);
    }
    setScoreDeltaToast({
      id: Date.now() + Math.floor(Math.random() * 1000),
      delta,
      reason,
    });
    scoreDeltaTimerRef.current = window.setTimeout(() => {
      setScoreDeltaToast(null);
    }, 2600);
  };

  // Mostrar notificación flotante en la barra de Alerta de Intrusión (IDS)
  const showIdsToast = (delta: number, reason: string, isReset = false) => {
    if (idsDeltaTimerRef.current) {
      window.clearTimeout(idsDeltaTimerRef.current);
    }
    setIdsDeltaToast({
      id: Date.now() + Math.floor(Math.random() * 1000),
      delta,
      reason,
      isReset,
    });
    idsDeltaTimerRef.current = window.setTimeout(() => {
      setIdsDeltaToast(null);
    }, 2800);
  };

  // Precargar la imagen del logo de Fsociety (assets/img/fsociety_emblem.jpg) en Base64 para jsPDF
  useEffect(() => {
    let isActive = true;
    const preloadLogo = async () => {
      try {
        const res = await fetch(FSOCIETY_REPORT_LOGO_PATH);
        if (!res.ok) return;
        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (isActive && typeof reader.result === 'string') {
            logoDataUrlRef.current = reader.result;
          }
        };
        reader.readAsDataURL(blob);
      } catch {
        // Ignorar errores de red en precarga
      }
    };
    preloadLogo();
    return () => {
      isActive = false;
    };
  }, []);

  // Sincronizar muted y volume del elemento <audio id="bg-music"> y persistir en localStorage
  useEffect(() => {
    if (bgMusicRef.current) {
      bgMusicRef.current.muted = isMuted;
      bgMusicRef.current.volume = isMuted ? 0 : masterVolume;
    }
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted));
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(masterVolume));
    } catch {
      // Ignore storage errors
    }
  }, [isMuted, masterVolume]);

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const nextMuted = !prev;
      const nextVol = !nextMuted && masterVolume === 0 ? 0.3 : masterVolume;
      if (!nextMuted && masterVolume === 0) {
        setMasterVolume(0.3);
      }
      if (bgMusicRef.current) {
        bgMusicRef.current.muted = nextMuted;
        bgMusicRef.current.volume = nextMuted ? 0 : nextVol;
        if (!nextMuted && sceneState !== 'SCENE_0') {
          bgMusicRef.current.play().catch(() => {});
        }
      }
      return nextMuted;
    });
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = Math.max(0, Math.min(1, parseFloat(e.target.value)));
    setMasterVolume(newVol);
    const shouldMute = newVol === 0;
    setIsMuted(shouldMute);
    if (bgMusicRef.current) {
      bgMusicRef.current.muted = shouldMute;
      bgMusicRef.current.volume = shouldMute ? 0 : newVol;
      if (!shouldMute && sceneState !== 'SCENE_0') {
        bgMusicRef.current.play().catch(() => {});
      }
    }
  };

  // ==========================================================================
  // SONIDOS DE INTERACCIÓN (SFX) MEDIANTE WEB AUDIO API
  // ==========================================================================
  const getAudioContext = (): AudioContext | null => {
    if (isMuted || masterVolume <= 0 || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  };

  // Sonido 1 (Tecleo - 'Bip'): Sonido sintético de 'bip' mecánico/CRT con variación dinámica según la tecla pulsada
  const playTypingSfx = (keyHint?: string) => {
    if (isMuted || masterVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const clickOsc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const peakGain = Math.max(0.003, 0.085 * masterVolume);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1650, now);
      filter.Q.setValueAtTime(1.8, now);

      // Variar ligeramente la frecuencia del 'bip' según la tecla (Enter, Backspace, Space, Tab o alfanumérica)
      let startFreq = 980 + Math.random() * 180;
      let endFreq = 1420 + Math.random() * 220;
      let duration = 0.028;

      if (keyHint === 'Backspace' || keyHint === 'Delete') {
        startFreq = 860;
        endFreq = 540;
        duration = 0.032;
      } else if (keyHint === ' ') {
        startFreq = 680;
        endFreq = 920;
        duration = 0.03;
      } else if (keyHint === 'Enter') {
        startFreq = 820;
        endFreq = 1280;
        duration = 0.04;
      } else if (keyHint === 'Tab' || keyHint === 'ArrowUp' || keyHint === 'ArrowDown') {
        startFreq = 1120;
        endFreq = 1560;
        duration = 0.03;
      }

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration * 0.85);

      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(startFreq * 2, now);
      clickOsc.frequency.exponentialRampToValueAtTime(endFreq * 1.5, now + duration * 0.5);

      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

      osc.connect(filter);
      clickOsc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      clickOsc.start(now);
      osc.stop(now + duration + 0.002);
      clickOsc.stop(now + duration * 0.6);
    } catch {
      // Ignore audio errors
    }
  };

  // Sonido 2 (Éxito): Acorde arpegiado armónico (D5 -> A5 -> D6) en la Web Audio API para acciones y comandos correctos
  const playSuccessSfx = () => {
    if (isMuted || masterVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const oscMain = ctx.createOscillator();
      const oscHarmonic = ctx.createOscillator();
      const gain = ctx.createGain();
      const peakGain = Math.max(0.004, 0.16 * masterVolume);

      // Arpegio ascendente de confirmación hacker (587.33Hz -> 880.0Hz -> 1174.66Hz)
      oscMain.type = 'sine';
      oscMain.frequency.setValueAtTime(587.33, now);
      oscMain.frequency.setValueAtTime(880.0, now + 0.065);
      oscMain.frequency.setValueAtTime(1174.66, now + 0.13);

      oscHarmonic.type = 'triangle';
      oscHarmonic.frequency.setValueAtTime(293.66, now);
      oscHarmonic.frequency.setValueAtTime(440.0, now + 0.065);
      oscHarmonic.frequency.setValueAtTime(587.33, now + 0.13);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(peakGain, now + 0.015);
      gain.gain.setValueAtTime(peakGain * 0.9, now + 0.13);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);

      oscMain.connect(gain);
      oscHarmonic.connect(gain);
      gain.connect(ctx.destination);

      oscMain.start(now);
      oscHarmonic.start(now);
      oscMain.stop(now + 0.29);
      oscHarmonic.stop(now + 0.29);
    } catch {
      // Ignore audio errors
    }
  };

  // Sonido 3 (Error): Doble oscilador disonante (sawtooth + square) con filtro paso-bajo para comandos fallidos
  const playErrorSfx = () => {
    if (isMuted || masterVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const peakGain = Math.max(0.004, 0.15 * masterVolume);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(640, now);
      filter.frequency.exponentialRampToValueAtTime(180, now + 0.24);

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(155.56, now); // D#3
      osc1.frequency.linearRampToValueAtTime(92.5, now + 0.22); // F#2

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(110.0, now); // A2 (intervalo de tritono disonante)
      osc2.frequency.linearRampToValueAtTime(65.41, now + 0.22); // C2

      // Doble pulso de zumbido de error de consola
      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.setValueAtTime(peakGain * 0.35, now + 0.075);
      gain.gain.setValueAtTime(peakGain * 0.9, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.25);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.26);
      osc2.stop(now + 0.26);
    } catch {
      // Ignore audio errors
    }
  };

  // Sonido 4 (IRC Ping): Bip corto cuando Darlene, Mr. Robot o Romero escriben en #fsociety-irc
  const playIrcPingSfx = () => {
    if (isMuted || masterVolume <= 0) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const peakGain = Math.max(0.002, 0.09 * masterVolume);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now);
      osc.frequency.setValueAtTime(1318.5, now + 0.045);

      gain.gain.setValueAtTime(peakGain, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    } catch {
      // Ignore audio errors
    }
  };

  // Helper para publicar un mensaje reactivo en #fsociety-irc
  const pushIrcMessage = (
    senderRole: IrcMessage['senderRole'],
    text: string,
    customNick?: string
  ) => {
    const defaultNickMap: Record<IrcMessage['senderRole'], string> = {
      darlene: '@d0loresH4ze',
      mr_robot: '@mr_robot',
      romero: '+ph4nt0m_romero',
      elliot: 'sam_sepi0l',
      system: '***',
    };
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    setIrcMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        time: timeStr,
        senderRole,
        nick: customNick || defaultNickMap[senderRole],
        text,
      },
    ]);

    if (senderRole !== 'elliot') {
      playIrcPingSfx();
      if (!isIrcOpen || isIrcMinimized) {
        setUnreadIrcCount((c) => c + 1);
      }
    }
  };

  // Helper para activar el Monólogo Interior de Elliot (Subtítulos + Voz Web Speech API / Pulso Atmosférico)
  const triggerElliotMonologue = (
    text: string,
    contextLabel = 'ELLIOT // MONÓLOGO INTERIOR',
    isParanoia = false
  ) => {
    if (monologueTimeoutRef.current) {
      window.clearTimeout(monologueTimeoutRef.current);
    }

    setActiveMonologue({
      id: Date.now(),
      text,
      contextLabel,
      isParanoia,
    });

    // Pulso grave psicológico por Web Audio API + síntesis de voz opcional (speechSynthesis)
    if (!isMuted && masterVolume > 0 && isVoiceMonologueEnabled && typeof window !== 'undefined') {
      try {
        const ctx = getAudioContext();
        if (ctx) {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = isParanoia ? 'sawtooth' : 'sine';
          osc.frequency.setValueAtTime(isParanoia ? 98 : 130.81, now);
          osc.frequency.exponentialRampToValueAtTime(isParanoia ? 65 : 110, now + 0.38);
          gain.gain.setValueAtTime(Math.max(0.002, 0.08 * masterVolume), now);
          gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.42);
        }
      } catch {
        // Ignore audio errors
      }

      try {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const cleanSpeechText = text.replace(/[“”"]/g, '');
          const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
          utterance.lang = 'es-ES';
          utterance.pitch = isParanoia ? 0.68 : 0.78;
          utterance.rate = isParanoia ? 0.96 : 0.9;
          utterance.volume = Math.min(1, masterVolume);
          const voices = window.speechSynthesis.getVoices();
          const spanishVoice = voices.find((v) => v.lang.toLowerCase().startsWith('es'));
          if (spanishVoice) {
            utterance.voice = spanishVoice;
          }
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        // Ignore speech synthesis restrictions
      }
    }

    monologueTimeoutRef.current = window.setTimeout(() => {
      setActiveMonologue(null);
    }, 9500);
  };

  // Auto-scroll en #fsociety-irc al recibir mensajes nuevos
  useEffect(() => {
    if (ircListRef.current) {
      ircListRef.current.scrollTop = ircListRef.current.scrollHeight;
    }
  }, [ircMessages, isIrcOpen, isIrcMinimized]);

  // Limpiar contador de no leídos al abrir/restaurar #fsociety-irc
  useEffect(() => {
    if (isIrcOpen && !isIrcMinimized) {
      setUnreadIrcCount(0);
    }
  }, [isIrcOpen, isIrcMinimized]);

  // Disparar Monólogo Interior de Elliot y mensajes reactivos en #fsociety-irc al cambiar de escena
  useEffect(() => {
    if (sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING') return;

    const sceneMono = SCENE_MONOLOGUES[sceneState];
    if (sceneMono) {
      triggerElliotMonologue(sceneMono.text, sceneMono.label, false);
    }

    if (sceneState === 'SCENE_1') {
      pushIrcMessage(
        'darlene',
        'El portal web de ECorp tiene una inyección SQL de manual en /login.php?id=1. Dale con sqlmap.'
      );
    } else if (sceneState === 'SCENE_2') {
      pushIrcMessage(
        'romero',
        'Estás en la subred 10.0.0.0/24. Busca impresoras HP con el puerto 21 abierto, esos sysadmins nunca cambian el FTP anónimo.'
      );
    } else if (sceneState === 'SCENE_3') {
      pushIrcMessage(
        'darlene',
        'Tenemos las credenciales de print-admin. Entra al SMB //10.0.0.50/Security_Logs y saca el CSV con los UIDs RFID.'
      );
    } else if (sceneState === 'SCENE_4') {
      pushIrcMessage(
        'mr_robot',
        '10.0.0.100. El despacho del ejecutivo. Fuerza su SSH con Hydra y el diccionario rockyou.txt.'
      );
    } else if (sceneState === 'SCENE_5') {
      pushIrcMessage(
        'romero',
        'Estoy en la furgoneta frente al edificio con la antena direccional. Levanta evil_portal.py en wlan0mon para cazar al guardia.'
      );
    } else if (sceneState === 'SCENE_6') {
      pushIrcMessage(
        'mr_robot',
        'Estás frente a la puerta acorazada, Elliot. Conecta minicom a /dev/ttyUSB0 y mete el código de 7 dígitos.'
      );
    } else if (sceneState === 'WIN') {
      pushIrcMessage(
        'darlene',
        '¡¡LO TENEMOS!! El pendrive de la bóveda está fuera. Sal de ahí ahora mismo, nos vemos en el Arcade.'
      );
      pushIrcMessage(
        'mr_robot',
        'Te dije que cambiaríamos el mundo, amigo. Bienvenido al verdadero Fsociety.'
      );
    }
  }, [sceneState]);

  // Temporizador reactivo de demora en una fase: si el jugador tarda >45s o >95s en la misma escena, IRC reacciona
  useEffect(() => {
    if (sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING' || sceneState === 'WIN') {
      return;
    }

    const timer45 = window.setTimeout(() => {
      const slowPrompts: Record<string, { role: IrcMessage['senderRole']; msg: string }> = {
        SCENE_1: {
          role: 'darlene',
          msg: '¿Elliot? Llevas rato en el portal web. Usa sqlmap -u "http://ecorp.com/login.php?id=1" --dbs y luego --dump.',
        },
        SCENE_2: {
          role: 'romero',
          msg: 'Chico, no te duermas en la red interna. Haz ftp 10.0.0.15 y bájate config_backup.bak antes de que rote el turno.',
        },
        SCENE_3: {
          role: 'darlene',
          msg: '¿Sigues en el servidor de seguridad? Clona ya el UID con proxmark3 -c "hf mf cload -f 047AB219C855".',
        },
        SCENE_4: {
          role: 'mr_robot',
          msg: 'El reloj corre, Elliot. El código de la bóveda está en safe_code.b64, decodifícalo con base64 -d.',
        },
        SCENE_5: {
          role: 'romero',
          msg: 'Hace un frío del demonio aquí fuera. Apaga la alarma por curl y entra por telnet 192.168.99.20 a la cámara.',
        },
        SCENE_6: {
          role: 'mr_robot',
          msg: 'Abre el puerto serie con minicom -D /dev/ttyUSB0 e introduce 7355608. Terminemos con esto.',
        },
      };
      const entry = slowPrompts[sceneState];
      if (entry) {
        pushIrcMessage(entry.role, entry.msg);
      }
    }, 45000);

    const timer95 = window.setTimeout(() => {
      pushIrcMessage(
        'romero',
        'Eh, el tráfico hacia ECorp lleva demasiado tiempo abierto en este nodo. Si te atascas, revisa "ls -la" o escribe "hint".'
      );
    }, 95000);

    return () => {
      window.clearTimeout(timer45);
      window.clearTimeout(timer95);
    };
  }, [sceneState]);

  // ==========================================================================
  // LEADERBOARD SPEEDRUN TOP 5 (localStorage) + GENERACIÓN DE CERTIFICADO PDF
  // ==========================================================================
  const upsertLeaderboardRecord = (aliasOverride?: string) => {
    const cleanAlias = (aliasOverride ?? hackerAliasInput).trim() || 'Elliot_Alderson';
    const rankRes = calculateOperatorRank({
      elapsedSeconds,
      failedAttempts: totalFailedAttempts,
      hintsUsed,
      logsCleared,
      debugAuthUsed,
      liveScore: playerScore,
      difficulty,
    });
    const todayStr = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    if (!currentRunIdRef.current) {
      currentRunIdRef.current = `run-${Date.now()}`;
    }
    const runId = currentRunIdRef.current;

    const newEntry: LeaderboardEntry = {
      id: runId,
      alias: cleanAlias,
      elapsedSeconds,
      rank: rankRes.grade,
      score: rankRes.score,
      failedAttempts: totalFailedAttempts,
      hintsUsed,
      logsCleared,
      debugAuthUsed,
      date: todayStr,
    };

    setLeaderboard((prev) => {
      const filtered = prev.filter((item) => item.id !== runId);
      const merged = [...filtered, newEntry].sort((a, b) => {
        if (a.elapsedSeconds !== b.elapsedSeconds) {
          return a.elapsedSeconds - b.elapsedSeconds;
        }
        return b.score - a.score;
      });
      const top5 = merged.slice(0, 5);
      try {
        window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(top5));
      } catch {
        // Ignore storage errors
      }
      return top5;
    });
  };

  const handleResetLeaderboard = () => {
    currentRunIdRef.current = null;
    setLeaderboard(DEFAULT_BENCHMARK_LEADERBOARD);
    try {
      window.localStorage.setItem(
        LEADERBOARD_STORAGE_KEY,
        JSON.stringify(DEFAULT_BENCHMARK_LEADERBOARD)
      );
    } catch {
      // Ignore storage errors
    }
  };

  // Registrar automáticamente el tiempo del jugador en el Top 5 al entrar en la pantalla de victoria (WIN)
  useEffect(() => {
    if (sceneState === 'WIN') {
      upsertLeaderboardRecord(hackerAliasInput);
    }
  }, [sceneState]);

  const loadLogoDataUrl = async (): Promise<string | null> => {
    if (logoDataUrlRef.current) {
      return logoDataUrlRef.current;
    }
    try {
      const res = await fetch(FSOCIETY_REPORT_LOGO_PATH);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            logoDataUrlRef.current = reader.result;
            resolve(reader.result);
          } else {
            resolve(null);
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const generateMissionReportPDF = async (aliasRaw: string) => {
    const hackerAlias = aliasRaw.trim() || 'Elliot_Alderson';
    upsertLeaderboardRecord(hackerAlias);
    const logoDataUrl = await loadLogoDataUrl();

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth(); // 297 mm
    const pageHeight = doc.internal.pageSize.getHeight(); // 210 mm
    const todayStr = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const totalTimeStr = formatUptime(elapsedSeconds).replace('UPTIME: ', '');

    // Calcular calificación final (S+, A, B, C) y Hash SHA256
    const rankInfo = calculateOperatorRank({
      elapsedSeconds,
      failedAttempts: totalFailedAttempts,
      hintsUsed,
      logsCleared,
      debugAuthUsed,
      liveScore: playerScore,
      difficulty,
    });
    const signatureHex = computeVerificationHash(hackerAlias, totalTimeStr, rankInfo.grade);

    // Payload codificado dentro del Código QR Vectorial
    const qrPayload = `FSOCIETY_5/9|ALIAS:${hackerAlias}|UPTIME:${totalTimeStr}|FAILS:${totalFailedAttempts}|METAHACK:${debugAuthUsed ? 'YES' : 'NO'}|RANK:${rankInfo.grade}(${rankInfo.score}PTS)|${signatureHex}`;
    const qrMatrix = buildQrMatrix(qrPayload);

    // Fondo oscuro completo (#0a0a0c)
    doc.setFillColor(10, 10, 12);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');

    // Doble marco perimetral hacker (rojo sangre + verde terminal)
    doc.setDrawColor(217, 20, 36);
    doc.setLineWidth(1.6);
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20, 'S');

    doc.setDrawColor(0, 255, 65);
    doc.setLineWidth(0.5);
    doc.rect(14, 14, pageWidth - 28, pageHeight - 28, 'S');

    // ========================================================================
    // COLUMNA IZQUIERDA: LOGO OFICIAL FSOCIETY (assets/img/fsociety_emblem.jpg)
    // ========================================================================
    const logoBoxX = 22;
    const logoBoxY = 22;
    const logoBoxW = 74;
    const logoBoxH = 166;

    doc.setDrawColor(217, 20, 36);
    doc.setFillColor(13, 13, 16);
    doc.setLineWidth(0.8);
    doc.rect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 'FD');

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 255, 65);
    doc.text('FSOCIETY // EMBLEM_00', logoBoxX + logoBoxW / 2, logoBoxY + 6.5, {
      align: 'center',
    });

    // Marco interior para la ilustración vertical de Fsociety
    const imgX = logoBoxX + 3;
    const imgY = logoBoxY + 9.5;
    const imgW = logoBoxW - 6; // 68 mm
    const imgH = 136; // Proporción vertical fiel a la imagen adjunta

    doc.setDrawColor(0, 255, 65);
    doc.setLineWidth(0.4);
    doc.rect(imgX - 0.6, imgY - 0.6, imgW + 1.2, imgH + 1.2, 'S');

    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'JPEG', imgX, imgY, imgW, imgH);
      } catch {
        // En caso de fallo de decodificación de imagen, mantener el sello vectorial
      }
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(217, 20, 36);
    doc.text('NODE: CONEY ISLAND ARCADE', logoBoxX + logoBoxW / 2, logoBoxY + 153, {
      align: 'center',
    });

    doc.setFont('courier', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(190, 190, 200);
    doc.text('ID: OP-5/9-DECRYPTION-KEY', logoBoxX + logoBoxW / 2, logoBoxY + 160, {
      align: 'center',
    });

    // ========================================================================
    // COLUMNA DERECHA: CERTIFICADO DE OPERACIÓN COMPLETADA + RANGO + QR VECTORIAL
    // ========================================================================
    const rightLeft = 104;
    const rightRight = pageWidth - 22; // 275 mm
    const rightWidth = rightRight - rightLeft; // 171 mm
    const rightCenterX = rightLeft + rightWidth / 2; // 189.5 mm

    // Cabecera clasificada
    doc.setFont('courier', 'bold');
    doc.setFontSize(9.2);
    doc.setTextColor(217, 20, 36);
    doc.text(
      '/// CLASIFICADO: DIRECTIVA FSOCIETY - OPERACION ECORP FALL ///',
      rightCenterX,
      27,
      { align: 'center' }
    );

    // Título principal
    doc.setFontSize(20);
    doc.setTextColor(0, 255, 65);
    doc.text('INFORME DE MISION COMPLETADA', rightCenterX, 38, { align: 'center' });

    doc.setDrawColor(0, 255, 65);
    doc.setLineWidth(0.5);
    doc.line(rightLeft + 4, 42, rightRight - 4, 42);

    // Cuerpo estilo máquina de escribir
    doc.setFont('courier', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(244, 241, 234);
    doc.text(
      'Por la presente se certifica que el operador identificado bajo el alias:',
      rightCenterX,
      50,
      { align: 'center' }
    );

    // Alias Hacker
    doc.setFont('courier', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(217, 20, 36);
    doc.text(`[ ${hackerAlias} ]`, rightCenterX, 61, { align: 'center' });

    // Resumen de intrusión
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(212, 212, 216);
    const reportLines = [
      'ha ejecutado con exito la intrusion completa contra la infraestructura de ECorp,',
      'superando todos los nodos de seguridad: SQL Injection perimetral, extraccion FTP,',
      'movimiento lateral SMB, clonado RFID (Proxmark3), fuerza bruta SSH al CEO,',
      'sabotaje exterior mediante Evil Portal / Telnet y apertura serie de la Boveda.',
    ];
    doc.text(reportLines, rightCenterX, 70, { align: 'center', lineHeightFactor: 1.38 });

    // Fila de los 5 Nodos Comprometidos en la columna derecha
    const nodes = [
      '01 WEB SQLi',
      '02 FTP/SMB',
      '03 RFID CLONE',
      '04 CEO SSH',
      '05 VAULT TTY',
    ];
    const gap = 3;
    const boxW = (rightWidth - gap * 4) / 5;
    nodes.forEach((label, idx) => {
      const x = rightLeft + idx * (boxW + gap);
      doc.setDrawColor(0, 255, 65);
      doc.setFillColor(14, 22, 16);
      doc.rect(x, 91, boxW, 11, 'FD');
      doc.setFont('courier', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(0, 255, 65);
      doc.text(label, x + boxW / 2, 95.6, { align: 'center' });
      doc.setFontSize(6.6);
      doc.setTextColor(244, 241, 234);
      doc.text('[ PWNED ]', x + boxW / 2, 100.1, { align: 'center' });
    });

    // Barra de Escala de Rangos Estilizada en el PDF (S+, A, B, C)
    const scaleY = 104.5;
    const scaleH = 8.5;
    doc.setDrawColor(80, 80, 95);
    doc.setFillColor(13, 15, 19);
    doc.setLineWidth(0.4);
    doc.rect(rightLeft, scaleY, rightWidth, scaleH, 'FD');

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(190, 190, 205);
    doc.text('ESCALA DE RANGO OPERATIVO:', rightLeft + 3.5, scaleY + 5.6);

    const allGrades: Array<{ g: OperatorRankGrade; rgb: [number, number, number] }> = [
      { g: 'S+', rgb: [0, 255, 65] },
      { g: 'A', rgb: [56, 189, 248] },
      { g: 'B', rgb: [255, 189, 46] },
      { g: 'C', rgb: [255, 0, 51] },
    ];
    allGrades.forEach((item, idx) => {
      const chipX = rightLeft + 62 + idx * 16;
      const chipY = scaleY + 1.3;
      const chipW = 13.5;
      const chipH = 5.9;
      const isEarned = item.g === rankInfo.grade;
      if (isEarned) {
        doc.setDrawColor(item.rgb[0], item.rgb[1], item.rgb[2]);
        doc.setFillColor(item.rgb[0], item.rgb[1], item.rgb[2]);
        doc.rect(chipX, chipY, chipW, chipH, 'FD');
        doc.setTextColor(10, 10, 12);
      } else {
        doc.setDrawColor(75, 75, 85);
        doc.setFillColor(18, 20, 24);
        doc.rect(chipX, chipY, chipW, chipH, 'FD');
        doc.setTextColor(120, 120, 130);
      }
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.2);
      doc.text(item.g, chipX + chipW / 2, chipY + 4.3, { align: 'center' });
    });

    doc.setFont('courier', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.text(rankInfo.title, rightRight - 3.5, scaleY + 5.6, { align: 'right' });

    // ========================================================================
    // PANEL DE AUDITORÍA: DESGLOSE (UPTIME + FAILEDATTEMPTS + META-HACKS) + SELLO RANGO + QR
    // ========================================================================
    const auditY = 115.5;
    const auditH = 60.5;
    doc.setDrawColor(217, 20, 36);
    doc.setFillColor(16, 16, 20);
    doc.setLineWidth(0.7);
    doc.rect(rightLeft, auditY, rightWidth, auditH, 'FD');

    // Sub-columna 1: Desglose de Criterios del Rango y Firma SHA256 (X: 108 a 193)
    const mLeft = rightLeft + 4;
    const uptimeBonusStr =
      rankInfo.uptimeDelta >= 0 ? `+${rankInfo.uptimeDelta} PTS` : `${rankInfo.uptimeDelta} PTS`;

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(0, 255, 65);
    doc.text('AUDITORIA DE RANGO (UPTIME / FALLOS / META-HACKS):', mLeft, auditY + 7);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(244, 241, 234);
    doc.text(
      `1. UPTIME       : ${totalTimeStr} [${rankInfo.uptimeTierLabel}] (${uptimeBonusStr})`,
      mLeft,
      auditY + 14.5
    );

    doc.setTextColor(totalFailedAttempts === 0 ? 0 : 255, totalFailedAttempts === 0 ? 255 : 189, totalFailedAttempts === 0 ? 65 : 46);
    doc.text(
      `2. FAILED CMDS  : ${totalFailedAttempts} errores (${rankInfo.failuresPenalty} PTS) | HINTS: ${hintsUsed}`,
      mLeft,
      auditY + 21.8
    );

    if (debugAuthUsed) {
      doc.setTextColor(56, 189, 248);
    } else {
      doc.setTextColor(195, 195, 205);
    }
    doc.text(`3. META-HACKS   : ${rankInfo.metaHackLabel}`, mLeft, auditY + 29.1);

    if (logsCleared) {
      doc.setTextColor(0, 255, 65);
      doc.text('4. HUELLA /LOG  : 0% GHOST OPERATOR (+130 PTS)', mLeft, auditY + 36.4);
    } else {
      doc.setTextColor(255, 189, 46);
      doc.text('4. HUELLA /LOG  : RASTRO ACTIVO EN DISCO (0 PTS)', mLeft, auditY + 36.4);
    }

    doc.setFont('courier', 'normal');
    doc.setFontSize(6.9);
    doc.setTextColor(180, 180, 192);
    doc.text(`EXPEDICION: ${todayStr} | SCORE EN VIVO: ${playerScore} PTS`, mLeft, auditY + 43.5);
    doc.text(signatureHex, mLeft, auditY + 50.2);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.1);
    doc.setTextColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.text(`RANGO CERTIFICADO: [${rankInfo.grade}] ${rankInfo.title}`, mLeft, auditY + 56.8);

    // Sub-columna 2: Sello Estilizado de Calificación Final (S+, A, B, C) (X: 196 a 230)
    const rankBoxX = 196;
    const rankBoxY = auditY + 3.5;
    const rankBoxW = 33;
    const rankBoxH = auditH - 7;

    doc.setDrawColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.setFillColor(10, 12, 15);
    doc.setLineWidth(0.9);
    doc.rect(rankBoxX, rankBoxY, rankBoxW, rankBoxH, 'FD');

    // Banda superior del sello de rango
    doc.setFillColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.rect(rankBoxX, rankBoxY, rankBoxW, 6.2, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(10, 10, 12);
    doc.text('RANGO FINAL', rankBoxX + rankBoxW / 2, rankBoxY + 4.4, { align: 'center' });

    // Letra gigante del rango (S+, A, B, C)
    doc.setFontSize(28);
    doc.setTextColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.text(rankInfo.grade, rankBoxX + rankBoxW / 2, rankBoxY + 26.5, { align: 'center' });

    // Barra de progreso vectorial de puntuación dentro del sello
    const barW = rankBoxW - 6;
    const barX = rankBoxX + 3;
    const barY = rankBoxY + 31;
    doc.setDrawColor(90, 90, 105);
    doc.setFillColor(22, 24, 30);
    doc.setLineWidth(0.3);
    doc.rect(barX, barY, barW, 3.2, 'FD');
    const fillW = Math.max(2, (Math.min(1000, rankInfo.score) / 1000) * barW);
    doc.setFillColor(rankInfo.colorRgb[0], rankInfo.colorRgb[1], rankInfo.colorRgb[2]);
    doc.rect(barX, barY, fillW, 3.2, 'F');

    doc.setFontSize(7.4);
    doc.setTextColor(244, 241, 234);
    doc.text(`${rankInfo.score} / 1000 PTS`, rankBoxX + rankBoxW / 2, rankBoxY + 40.5, {
      align: 'center',
    });

    doc.setFontSize(6.1);
    doc.setTextColor(0, 255, 65);
    doc.text(
      debugAuthUsed ? 'META-HACK BONUS' : logsCleared ? 'GHOST OPERATOR' : 'FSOCIETY GRADE',
      rankBoxX + rankBoxW / 2,
      rankBoxY + 47.5,
      { align: 'center' }
    );

    // Sub-columna 3: Código QR Vectorial de Verificación (X: 233 a 271)
    const qrBoxX = 233;
    const qrBoxY = auditY + 3.5;
    const qrBoxW = 38;
    const qrBoxH = auditH - 7;

    doc.setDrawColor(0, 255, 65);
    doc.setFillColor(10, 12, 15);
    doc.setLineWidth(0.6);
    doc.rect(qrBoxX, qrBoxY, qrBoxW, qrBoxH, 'FD');

    // Lienzo blanco interior para máxima legibilidad de escaneo óptico del QR vectorial
    const qrPlateSize = 31;
    const qrPlateX = qrBoxX + (qrBoxW - qrPlateSize) / 2;
    const qrPlateY = qrBoxY + 3;
    doc.setFillColor(244, 241, 234);
    doc.rect(qrPlateX, qrPlateY, qrPlateSize, qrPlateSize, 'F');

    const matrixSize = qrMatrix.length;
    const quietZone = 1.6;
    const drawableSize = qrPlateSize - quietZone * 2;
    const cellSize = drawableSize / matrixSize;

    // Dibujar cada módulo oscuro del QR como rectángulo vectorial nativo en jsPDF
    doc.setFillColor(10, 10, 12);
    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        if (qrMatrix[r][c]) {
          doc.rect(
            qrPlateX + quietZone + c * cellSize,
            qrPlateY + quietZone + r * cellSize,
            cellSize + 0.04,
            cellSize + 0.04,
            'F'
          );
        }
      }
    }

    doc.setFont('courier', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(0, 255, 65);
    doc.text('QR VERIFY SHA256', qrBoxX + qrBoxW / 2, qrBoxY + 40.5, { align: 'center' });
    doc.setFont('courier', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(190, 190, 200);
    doc.text('VECTOR_AUTH_OK', qrBoxX + qrBoxW / 2, qrBoxY + 47.5, { align: 'center' });

    doc.setFont('courier', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(160, 160, 170);
    doc.text(
      '"Hello, friend. Our democracy has been hacked." — Fsociety Command',
      rightCenterX,
      183.5,
      { align: 'center' }
    );

    doc.save('fsociety_report.pdf');
    playSuccessSfx();
    setIsReportModalOpen(false);
  };

  // Función saveGame() para persistir el estado en localStorage
  const saveGame = (overrides?: Partial<SavedGameData>) => {
    const activeScene = overrides?.sceneState ?? sceneState;
    if (activeScene === 'SCENE_0' || activeScene === 'TRANSITIONING' || activeScene === 'WIN') {
      return;
    }

    const payload: SavedGameData = {
      sceneState: activeScene,
      elapsedSeconds: overrides?.elapsedSeconds ?? elapsedSeconds,
      internalStep: overrides?.internalStep ?? internalStep,
      securityStep: overrides?.securityStep ?? securityStep,
      ceoStep: overrides?.ceoStep ?? ceoStep,
      camStep: overrides?.camStep ?? exteriorStep,
      vaultStep: overrides?.vaultStep ?? vaultStep,
      currentPrompt: overrides?.currentPrompt ?? currentPrompt,
      windowTitle: overrides?.windowTitle ?? windowTitle,
      totalFailedAttempts: overrides?.totalFailedAttempts ?? totalFailedAttempts,
      hintsUsed: overrides?.hintsUsed ?? hintsUsed,
      logsCleared: overrides?.logsCleared ?? logsCleared,
      debugAuthUsed: overrides?.debugAuthUsed ?? debugAuthUsed,
      playerScore: overrides?.playerScore ?? playerScore,
      threatLevel: overrides?.threatLevel ?? threatLevel,
      operatorSpoofedMac: overrides?.operatorSpoofedMac ?? operatorSpoofedMac,
      commandHistory: overrides?.commandHistory ?? commandHistory,
      isGodModeUnlocked: overrides?.isGodModeUnlocked ?? isGodModeUnlocked,
      difficulty: overrides?.difficulty ?? difficulty,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  };

  // Inicialización silenciosa de Meta-Hacking (DevTools F12) + loadGame() al cargar la página
  useEffect(() => {
    if (hasLoadedSaveRef.current) return;
    hasLoadedSaveRef.current = true;

    // 1. Inyectar ecorp_debug_session en localStorage y sessionStorage + imprimir pista ASCII en Consola (F12)
    try {
      window.localStorage.setItem(DEBUG_SESSION_KEY, DEBUG_SESSION_HASH);
      window.sessionStorage.setItem(DEBUG_SESSION_KEY, DEBUG_SESSION_HASH);

      console.warn(`
  ______ _____  ____   _____ _____ ______ _________     __
 |  ____/ ____|/ __ \\ / ____|_   _|  ____|__   __\\ \\   / /
 | |__ | (___ | |  | | |      | | | |__     | |   \\ \\_/ / 
 |  __| \\___ \\| |  | | |      | | |  __|    | |    \\   /  
 | |    ____) | |__| | |____ _| |_| |____   | |     | |   
 |_|   |_____/ \\____/ \\_____|_____|______|  |_|     |_|   

[ECORP LEGACY DEBUG DAEMON v0.94 - UNAUTHORIZED ACCESS LOGGED]
--------------------------------------------------------------
[!] Llave de acceso de emergencia: ${EMERGENCY_B64_KEY}
[!] Debug Session Storage Key   : localStorage.getItem('${DEBUG_SESSION_KEY}')
[!] Terminal Backdoor Command   : debug_auth <token>
`);
    } catch {
      // Ignore storage errors
    }

    try {
      const rawSaved = window.localStorage.getItem(STORAGE_KEY);
      if (!rawSaved) return;

      const saved = JSON.parse(rawSaved) as Partial<SavedGameData>;
      if (
        !saved ||
        !saved.sceneState ||
        saved.sceneState === 'SCENE_0' ||
        saved.sceneState === 'TRANSITIONING' ||
        saved.sceneState === 'WIN'
      ) {
        return;
      }

      const safeCeoStep = saved.ceoStep === 1.5 ? 1 : Number(saved.ceoStep ?? 0);
      const safeCamStep =
        saved.camStep === 4 || saved.camStep === 5 ? 3 : Number(saved.camStep ?? 0);

      setSceneState(saved.sceneState);
      setElapsedSeconds(Number(saved.elapsedSeconds ?? 0));
      setInternalStep(Number(saved.internalStep ?? 0));
      setSecurityStep(Number(saved.securityStep ?? 0));
      setCeoStep(safeCeoStep);
      setExteriorStep(safeCamStep);
      setVaultStep(Number(saved.vaultStep ?? 0));
      setTotalFailedAttempts(Number(saved.totalFailedAttempts ?? 0));
      setHintsUsed(Number(saved.hintsUsed ?? 0));
      setLogsCleared(Boolean(saved.logsCleared));
      setDebugAuthUsed(Boolean(saved.debugAuthUsed));
      setPlayerScore(Number(saved.playerScore ?? 0));
      const restoredThreat = Math.max(0, Math.min(100, Number(saved.threatLevel ?? 0)));
      setThreatLevel(restoredThreat);
      threatLevelRef.current = restoredThreat;
      if (saved.operatorSpoofedMac) {
        setOperatorSpoofedMac(saved.operatorSpoofedMac);
      }
      if (saved.isGodModeUnlocked !== undefined) {
        setIsGodModeUnlocked(Boolean(saved.isGodModeUnlocked));
      }
      if (
        saved.difficulty === 'EASY' ||
        saved.difficulty === 'NORMAL' ||
        saved.difficulty === 'HARD'
      ) {
        setDifficulty(saved.difficulty);
        difficultyRef.current = saved.difficulty;
      }
      if (Array.isArray(saved.commandHistory)) {
        const cleanHist = saved.commandHistory.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0
        );
        setCommandHistory(cleanHist);
        setHistoryIndex(cleanHist.length);
      }
      setCurrentPrompt(
        saved.currentPrompt && saved.currentPrompt.length > 0
          ? saved.currentPrompt
          : 'elliot@fsociety:~#'
      );
      setWindowTitle(saved.windowTitle || 'elliot@fsociety:~');

      setTerminalLogs((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'success',
          text: '[SISTEMA] Sesión anterior restaurada.',
        },
      ]);
    } catch {
      // Ignore malformed storage
    }
  }, []);

  // Guardar automáticamente cada vez que el jugador avanza de paso o escena
  useEffect(() => {
    if (!hasLoadedSaveRef.current) return;
    if (sceneState !== 'SCENE_0' && sceneState !== 'TRANSITIONING' && sceneState !== 'WIN') {
      saveGame();
    }
  }, [
    sceneState,
    internalStep,
    securityStep,
    ceoStep,
    exteriorStep,
    vaultStep,
    currentPrompt,
    windowTitle,
    totalFailedAttempts,
    hintsUsed,
    logsCleared,
    debugAuthUsed,
    playerScore,
    threatLevel,
    operatorSpoofedMac,
    commandHistory,
    isGodModeUnlocked,
    difficulty,
  ]);

  // Temporizador de Speedrun con setInterval (activo desde Escena 1 hasta antes de WIN)
  useEffect(() => {
    if (sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING' || sceneState === 'WIN') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((prev) => {
        const nextVal = prev + 1;
        saveGame({ elapsedSeconds: nextVal });
        return nextVal;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [sceneState, internalStep, securityStep, ceoStep, exteriorStep, vaultStep, currentPrompt]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
      if (execIntervalRef.current) window.clearInterval(execIntervalRef.current);
      if (execTimeoutRef.current) window.clearTimeout(execTimeoutRef.current);
      if (paranoiaTimerRef.current) window.clearTimeout(paranoiaTimerRef.current);
      if (monologueTimeoutRef.current) window.clearTimeout(monologueTimeoutRef.current);
      document.body.classList.remove('paranoia-glitch-active');
    };
  }, []);

  // ==========================================================================
  // MOTOR DE PARANOIA EN SEGUNDO PLANO (INTERVALOS ALEATORIOS 30s A 90s)
  // ==========================================================================
  useEffect(() => {
    if (sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING' || sceneState === 'WIN') {
      return;
    }

    let isCancelled = false;

    const triggerRandomParanoiaEvent = () => {
      if (isCancelled) return;
      const eventType = Math.floor(Math.random() * 3); // 0 = Glitch body, 1 = Línea fantasma, 2 = Blur terminal

      if (eventType === 0) {
        // Evento 1: Glitch CSS en todo el body durante 200ms
        document.body.classList.add('paranoia-glitch-active');
        window.setTimeout(() => {
          document.body.classList.remove('paranoia-glitch-active');
        }, 200);
        triggerElliotMonologue(
          '“¿Viste eso, amigo? La pantalla acaba de distorsionarse... ¿Están interceptando mi sesión o todo esto vuelve a estar en mi cabeza?”',
          'MOTOR DE PARANOIA // DISOCIACIÓN VISUAL',
          true
        );
      } else if (eventType === 1) {
        // Evento 2: Inyectar línea fantasma ("WAKE UP" o "HE IS WATCHING") y borrarla 500ms después
        const messages = ['WAKE UP', 'HE IS WATCHING'];
        const chosenMsg = messages[Math.floor(Math.random() * messages.length)];
        setPhantomHallucination(chosenMsg);
        window.setTimeout(() => {
          setPhantomHallucination(null);
        }, 500);
        triggerElliotMonologue(
          `“${chosenMsg}... Él sigue ahí, observando detrás del cristal del monitor. Respira, Elliot. Solo son paquetes TCP y demonios en memoria.”`,
          'MOTOR DE PARANOIA // ALUCINACIÓN EN CONSOLA',
          true
        );
      } else {
        // Evento 3: Desenfocar ligeramente la terminal (filter: blur(2px)) y volver a enfocarla poco a poco
        setIsTerminalBlurred(true);
        window.setTimeout(() => {
          setIsTerminalBlurred(false);
        }, 650);
        triggerElliotMonologue(
          '“Las líneas de código se desenfocan. ¿Cuántas horas llevo sin dormir frente a esta terminal de Kali?”',
          'MOTOR DE PARANOIA // FATIGA COGNITIVA',
          true
        );
      }
    };

    const scheduleNextParanoia = () => {
      const randomDelayMs = Math.floor(Math.random() * (90000 - 30000 + 1)) + 30000;
      paranoiaTimerRef.current = window.setTimeout(() => {
        if (!isCancelled) {
          triggerRandomParanoiaEvent();
          scheduleNextParanoia();
        }
      }, randomDelayMs);
    };

    scheduleNextParanoia();

    return () => {
      isCancelled = true;
      if (paranoiaTimerRef.current) {
        window.clearTimeout(paranoiaTimerRef.current);
      }
    };
  }, [sceneState]);

  // Auto-scroll hacia abajo en #terminal-output al añadir líneas
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminalLogs, phantomHallucination]);

  // Actualización en tiempo real del comando 'top' cuando hay un monitor de procesos activo en la terminal
  const hasActiveTopMonitor = terminalLogs.some((entry) => entry.type === 'top');
  useEffect(() => {
    if (
      !hasActiveTopMonitor ||
      topPaused ||
      sceneState === 'SCENE_0' ||
      sceneState === 'TRANSITIONING' ||
      sceneState === 'WIN'
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setTopTelemetry((prev) => {
        const now = Date.now();
        const isTamperSpiked = now < prev.tamperSpikeUntil;
        const threatBoost = (threatLevel / 100) * 12;

        // Oscilación variable de CPU y RAM para el proceso crítico de seguridad de ECorp (PID 1337: ecorp_sec_agent)
        const rawSecCpu = isTamperSpiked
          ? 88.0 + Math.random() * 11.4
          : Math.max(
              18.2,
              Math.min(78.5, prev.secCpu + (Math.random() - 0.48) * 14.5 + threatBoost * 0.18)
            );
        const nextSecCpu = Number(rawSecCpu.toFixed(1));

        const rawSecMem = isTamperSpiked
          ? 36.5 + Math.random() * 6.8
          : Math.max(14.5, Math.min(34.8, prev.secMem + (Math.random() - 0.49) * 3.4));
        const nextSecMem = Number(rawSecMem.toFixed(1));
        const nextSecResMb = Math.round((nextSecMem / 100) * 16384);

        const nextSiemCpu = Number(
          Math.max(
            3.2,
            Math.min(24.9, prev.siemCpu + (Math.random() - 0.49) * 4.2 + threatBoost * 0.15)
          ).toFixed(1)
        );
        const nextSiemMem = Number(
          Math.max(6.8, Math.min(14.5, prev.siemMem + (Math.random() - 0.5) * 1.1)).toFixed(1)
        );
        const nextNodeCpu = Number(
          Math.max(1.8, Math.min(16.4, prev.nodeCpu + (Math.random() - 0.5) * 3.6)).toFixed(1)
        );
        const nextNodeMem = Number(
          Math.max(5.0, Math.min(11.2, prev.nodeMem + (Math.random() - 0.5) * 0.8)).toFixed(1)
        );
        const nextDbCpu = Number(
          Math.max(2.1, Math.min(14.8, prev.dbCpu + (Math.random() - 0.5) * 3.2)).toFixed(1)
        );
        const nextDbMem = Number(
          Math.max(9.2, Math.min(15.6, prev.dbMem + (Math.random() - 0.5) * 0.7)).toFixed(1)
        );
        const nextLogCpu = logsCleared
          ? 0.4
          : Number(
              Math.max(1.2, Math.min(9.6, prev.logCpu + (Math.random() - 0.5) * 2.4)).toFixed(1)
            );
        const nextLogMem = logsCleared
          ? 1.1
          : Number(
              Math.max(2.8, Math.min(6.4, prev.logMem + (Math.random() - 0.5) * 0.5)).toFixed(1)
            );
        const nextSyncCpu = Number(
          Math.max(0.9, Math.min(8.4, prev.syncCpu + (Math.random() - 0.5) * 2.1)).toFixed(1)
        );
        const nextSyncMem = Number(
          Math.max(2.6, Math.min(5.8, prev.syncMem + (Math.random() - 0.5) * 0.4)).toFixed(1)
        );
        const isCamStopped = sceneState === 'SCENE_5' && exteriorStep >= 7;
        const nextCamCpu = isCamStopped
          ? 0.0
          : Number(
              Math.max(2.0, Math.min(9.5, prev.camCpu + (Math.random() - 0.5) * 2.2)).toFixed(1)
            );
        const nextCamMem = isCamStopped ? 0.0 : prev.camMem;

        const nextSysCpu = Number(
          Math.max(
            2.1,
            Math.min(14.8, (nextSecCpu + nextSiemCpu + nextDbCpu) * 0.13)
          ).toFixed(1)
        );

        const rawTotalCpu =
          nextSecCpu +
          nextSiemCpu +
          nextNodeCpu +
          nextDbCpu * 0.45 +
          nextLogCpu * 0.35 +
          nextSysCpu;
        const clampedTotalCpu = Math.min(99.9, Math.max(12.0, Number(rawTotalCpu.toFixed(1))));

        const rawTotalMem =
          nextSecMem +
          nextSiemMem +
          nextNodeMem +
          nextDbMem +
          nextLogMem +
          nextSyncMem +
          nextCamMem +
          3.4;
        const clampedTotalMem = Math.min(98.5, Math.max(28.0, Number(rawTotalMem.toFixed(1))));

        // Carga dinámica individual para los 4 núcleos Xeon de ECorp
        const c0 = Number(
          Math.min(99.9, Math.max(15.0, nextSecCpu * 0.95 + Math.random() * 14)).toFixed(1)
        );
        const c1 = Number(
          Math.min(
            99.9,
            Math.max(12.0, (nextSecCpu * 0.55 + nextSiemCpu * 1.4 + Math.random() * 12))
          ).toFixed(1)
        );
        const c2 = Number(
          Math.min(
            99.9,
            Math.max(10.0, nextNodeCpu * 1.8 + nextDbCpu * 1.7 + Math.random() * 11)
          ).toFixed(1)
        );
        const c3 = Number(
          Math.min(
            99.9,
            Math.max(8.0, nextLogCpu * 2.1 + nextSyncCpu * 2.0 + nextSysCpu * 1.5 + Math.random() * 10)
          ).toFixed(1)
        );

        const nextSwapUsedMb = isTamperSpiked
          ? Math.min(4096, prev.swapUsedMb + Math.round(45 + Math.random() * 90))
          : Math.max(380, Math.min(2480, prev.swapUsedMb + Math.round((Math.random() - 0.49) * 38)));
        const nextCacheMemMb = Math.max(
          1420,
          Math.min(3400, prev.cacheMemMb + Math.round((Math.random() - 0.5) * 44))
        );

        const nextNetRx = Math.max(
          240,
          Math.round(
            (isTamperSpiked ? 4800 : 980) +
              clampedTotalCpu * 18 +
              (Math.random() - 0.45) * 520
          )
        );
        const nextNetTx = Math.max(
          160,
          Math.round(
            (isTamperSpiked ? 3100 : 620) +
              clampedTotalCpu * 11 +
              (Math.random() - 0.45) * 340
          )
        );
        const nextDiskRead = Number(
          Math.max(1.4, (clampedTotalCpu * 0.28 + Math.random() * 9.5)).toFixed(1)
        );
        const nextDiskWrite = Number(
          Math.max(0.8, (clampedTotalCpu * 0.19 + (isTamperSpiked ? 42.0 : Math.random() * 7.2))).toFixed(1)
        );

        const l1 = (1.1 + clampedTotalCpu / 38).toFixed(2);
        const l5 = (1.05 + clampedTotalCpu / 50).toFixed(2);
        const l15 = (0.92 + clampedTotalCpu / 65).toFixed(2);

        return {
          secCpu: nextSecCpu,
          secMem: nextSecMem,
          secResMb: nextSecResMb,
          siemCpu: nextSiemCpu,
          siemMem: nextSiemMem,
          nodeCpu: nextNodeCpu,
          nodeMem: nextNodeMem,
          dbCpu: nextDbCpu,
          dbMem: nextDbMem,
          logCpu: nextLogCpu,
          logMem: nextLogMem,
          syncCpu: nextSyncCpu,
          syncMem: nextSyncMem,
          camCpu: nextCamCpu,
          camMem: nextCamMem,
          sysCpu: nextSysCpu,
          cores: [c0, c1, c2, c3],
          swapUsedMb: nextSwapUsedMb,
          cacheMemMb: nextCacheMemMb,
          netRxKbps: nextNetRx,
          netTxKbps: nextNetTx,
          diskReadMb: nextDiskRead,
          diskWriteMb: nextDiskWrite,
          cpuHistory: [...prev.cpuHistory.slice(-19), Math.round(clampedTotalCpu)],
          memHistory: [...prev.memHistory.slice(-19), Math.round(clampedTotalMem)],
          load1: l1,
          load5: l5,
          load15: l15,
          tickCount: prev.tickCount + 1,
          tamperSpikeUntil: prev.tamperSpikeUntil,
        };
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveTopMonitor, topPaused, sceneState, threatLevel, logsCleared, exteriorStep]);

  // Enfocar el input al entrar en cualquier escena de terminal o al terminar simulateExecution
  useEffect(() => {
    if (
      !isExecuting &&
      sceneState !== 'SCENE_0' &&
      sceneState !== 'TRANSITIONING' &&
      sceneState !== 'WIN'
    ) {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
    }
  }, [sceneState, isExecuting]);

  // Lógica de Arrastre (Draggable) para #kali-terminal, #network-map, #packet-sniffer y #fsociety-irc
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const nextX = Math.max(
          0,
          Math.min(window.innerWidth - 320, e.clientX - dragOffsetRef.current.offsetX)
        );
        const nextY = Math.max(
          0,
          Math.min(window.innerHeight - 80, e.clientY - dragOffsetRef.current.offsetY)
        );
        setTermPos({ x: nextX, y: nextY });
      }

      if (isDraggingMap) {
        const currentWidth = netMapRef.current?.offsetWidth || 280;
        const currentHeight = netMapRef.current?.offsetHeight || 42;
        const nextMapX = Math.max(
          0,
          Math.min(window.innerWidth - Math.min(currentWidth, 180), e.clientX - mapDragOffsetRef.current.offsetX)
        );
        const nextMapY = Math.max(
          0,
          Math.min(window.innerHeight - Math.min(currentHeight, 42), e.clientY - mapDragOffsetRef.current.offsetY)
        );
        setNetMapPos({ x: nextMapX, y: nextMapY });
      }

      if (isDraggingSniffer) {
        const currentWidth = snifferRef.current?.offsetWidth || 310;
        const currentHeight = snifferRef.current?.offsetHeight || 42;
        const nextSnifferX = Math.max(
          0,
          Math.min(
            window.innerWidth - Math.min(currentWidth, 180),
            e.clientX - snifferDragOffsetRef.current.offsetX
          )
        );
        const nextSnifferY = Math.max(
          0,
          Math.min(
            window.innerHeight - Math.min(currentHeight, 42),
            e.clientY - snifferDragOffsetRef.current.offsetY
          )
        );
        setSnifferPos({ x: nextSnifferX, y: nextSnifferY });
      }

      if (isDraggingIrc && !isIrcDocked) {
        const currentWidth = ircRef.current?.offsetWidth || 290;
        const currentHeight = ircRef.current?.offsetHeight || 42;
        const nextIrcX = Math.max(
          0,
          Math.min(
            window.innerWidth - Math.min(currentWidth, 180),
            e.clientX - ircDragOffsetRef.current.offsetX
          )
        );
        const nextIrcY = Math.max(
          0,
          Math.min(
            window.innerHeight - Math.min(currentHeight, 42),
            e.clientY - ircDragOffsetRef.current.offsetY
          )
        );
        setIrcPos({ x: nextIrcX, y: nextIrcY });
      }
    };

    const handleMouseUp = () => {
      if (isDragging) setIsDragging(false);
      if (isDraggingMap) setIsDraggingMap(false);
      if (isDraggingSniffer) setIsDraggingSniffer(false);
      if (isDraggingIrc) setIsDraggingIrc(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isDraggingMap, isDraggingSniffer, isDraggingIrc, isIrcDocked]);

  // Coloca terminal, mapa de red, IRC y sniffer sin solaparse según el tamaño de la ventana
  const applyWindowLayout = useCallback((isFirstEntry: boolean) => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const margin = W < 640 ? 8 : 14;
    const gap = 12;
    const barH = topbarRef.current?.offsetHeight ?? 60;
    const top = barH + gap;
    const isWide = W >= 1180;
    const sideW = isWide ? Math.min(410, Math.max(340, Math.round(W * 0.27))) : Math.min(390, W - margin * 2);
    const termW = Math.max(300, Math.min(1180, W - margin * 2 - (isWide ? sideW + gap : 0)));
    const termH = Math.max(260, H - top - margin);
    setTermPos({ x: margin, y: top });
    setTermSize({ w: termW, h: termH });

    const sideX = isWide ? margin + termW + gap : Math.max(margin, W - sideW - margin);
    const mapH = netMapRef.current?.offsetHeight || 318;
    const ircY = isWide ? top + mapH + gap : top + 40;
    const ircH = Math.max(200, Math.min(520, H - ircY - margin));
    setNetMapPos({ x: sideX, y: top });
    setIrcPos({ x: sideX, y: Math.min(ircY, Math.max(top, H - ircH - margin)) });
    setSidePanel({ w: sideW, ircH });
    setSnifferPos({
      x: Math.max(margin, margin + termW - Math.min(446, termW)),
      y: Math.max(top, H - 372),
    });

    if (isFirstEntry) {
      // En pantallas estrechas las ventanas auxiliares empiezan cerradas para no tapar la terminal
      setIsNetworkMapOpen(isWide);
      setIsIrcOpen(isWide);
      setIsIrcDocked(false);
    }
  }, []);

  const isGameActive =
    sceneState !== 'SCENE_0' && sceneState !== 'TRANSITIONING' && sceneState !== 'WIN';

  useEffect(() => {
    if (!isGameActive) return;
    let frame = window.requestAnimationFrame(() => {
      applyWindowLayout(true);
      // Segunda pasada: el mapa ya está pintado y se conoce su altura real
      frame = window.requestAnimationFrame(() => applyWindowLayout(false));
    });
    const onResize = () => applyWindowLayout(false);
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [isGameActive, applyWindowLayout]);

  const handleConfirmReset = () => {
    if (window.confirm('¿Borrar la partida guardada y volver a la pantalla de inicio?')) {
      handleResetGameComplete();
    }
  };

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (!terminalRef.current) return;
    const rect = terminalRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setIsDragging(true);
  };

  const handleMapHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Evitar que se inicie el arrastre si se hace clic en el botón [-] o en los botones de ventana
    if ((e.target as HTMLElement).closest('button, .kali-btn')) return;
    if (!netMapRef.current) return;
    const rect = netMapRef.current.getBoundingClientRect();
    mapDragOffsetRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setIsDraggingMap(true);
  };

  const handleSnifferHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, .kali-btn')) return;
    if (!snifferRef.current) return;
    const rect = snifferRef.current.getBoundingClientRect();
    snifferDragOffsetRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setIsDraggingSniffer(true);
  };

  const handleIrcHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, .kali-btn')) return;
    if (isIrcDocked || !ircRef.current) return;
    const rect = ircRef.current.getBoundingClientRect();
    ircDragOffsetRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setIsDraggingIrc(true);
  };

  // Enviar un mensaje desde el input del cliente IRC (#fsociety-irc) y recibir respuesta reactiva del equipo
  const handleSendIrcMessage = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const msg = ircInput.trim();
    if (!msg) return;
    playTypingSfx();
    setIrcInput('');
    pushIrcMessage('elliot', msg);

    const lower = msg.toLowerCase();
    window.setTimeout(() => {
      if (lower.includes('tyrell') || lower.includes('rfid') || lower.includes('uid')) {
        pushIrcMessage(
          'darlene',
          'El UID de Tyrell Wellick es 047AB219C855. Clónalo con: proxmark3 -c "hf mf cload -f 047AB219C855".'
        );
      } else if (lower.includes('romero') || lower.includes('alarma') || lower.includes('camara') || lower.includes('cámara')) {
        pushIrcMessage(
          'romero',
          'Aquí Romero. En el exterior primero lanza evil_portal.py, apaga la alarma con curl y luego entra por telnet 192.168.99.20 (root / 12345).'
        );
      } else if (lower.includes('allsafe') || lower.includes('ids') || lower.includes('mac') || lower.includes('bloqueo')) {
        pushIrcMessage(
          'romero',
          'Si el IDS de Allsafe te bloquea al 100%, ejecuta "macchanger -r wlan0mon" o "proxychains". Y no olvides "shred -u /var/log/auth.log" antes de salir.'
        );
      } else if (lower.includes('god_mode') || lower.includes('god') || lower.includes('acertijo') || lower.includes('enigma') || lower.includes('riddle')) {
        pushIrcMessage(
          'mr_robot',
          '¿Buscas el protocolo oculto "god_mode" para congelar el IDS 30 segundos? Primero resuelve mi acertijo con el comando previo "unlock_god root" (o "unlock_god fsociety") y luego ejecuta "god_mode".'
        );
      } else if (lower.includes('ayuda') || lower.includes('hint') || lower.includes('pista')) {
        pushIrcMessage('darlene', getHintMessageForState().replace('[Mensaje cifrado de Darlene]: ', ''));
      } else {
        const replies: Array<{ role: IrcMessage['senderRole']; text: string }> = [
          {
            role: 'mr_robot',
            text: 'Concéntrate en la terminal, Elliot. Cada segundo dentro de la red de ECorp cuenta.',
          },
          {
            role: 'darlene',
            text: 'Te copio, hermano. Revisa los archivos ocultos con "ls -la" si buscas pistas de los sysadmins.',
          },
          {
            role: 'romero',
            text: 'El túnel cifrado aguanta estable por ahora. Sigue avanzando hacia la bóveda.',
          },
        ];
        const pick = replies[Math.floor(Math.random() * replies.length)];
        pushIrcMessage(pick.role, pick.text);
      }
    }, 650);
  };

  // Función para abortar un escaneo en curso (Ctrl + C durante simulateExecution)
  const abortRunningExecution = () => {
    if (execIntervalRef.current) {
      window.clearInterval(execIntervalRef.current);
      execIntervalRef.current = null;
    }
    if (execTimeoutRef.current) {
      window.clearTimeout(execTimeoutRef.current);
      execTimeoutRef.current = null;
    }
    setIsExecuting(false);
    playErrorSfx();
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 998,
        type: 'output',
        text: '^C\n[!] Proceso abortado por el operador (SIGINT).',
      },
    ]);
  };

  // Resetear subdirectorio virtual al cambiar de escena
  useEffect(() => {
    setVfsSubdir('');
  }, [sceneState]);

  // Atajos globales de consola (Ctrl + C para abortar simulateExecution, Ctrl + L para limpiar)
  useEffect(() => {
    if (sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING' || sceneState === 'WIN') {
      return;
    }
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setTerminalLogs([]);
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'c' && isExecuting) {
        e.preventDefault();
        abortRunningExecution();
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
    };
  }, [sceneState, isExecuting]);

  // Incrementar gradualmente la barra de Alerta de Intrusión (IDS) ajustada por el multiplicador de dificultad y activar el bloqueo al alcanzar 100%
  const increaseIdsAlert = (
    delta: number,
    reason: string,
    targetEntries?: TerminalEntry[],
    showToast = true,
    skipDifficultyScale = false
  ): number => {
    // Si 'god_mode' está activo (30 segundos de inmunidad), deshabilitar cualquier incremento de la barra IDS
    if (godModeRemainingRef.current > 0 && delta > 0) {
      if (showToast) {
        showIdsToast(0, `GOD_MODE INMUNE (${godModeRemainingRef.current}s)`, true);
      }
      return threatLevelRef.current;
    }

    const activeDiff = DIFFICULTY_CONFIG[difficultyRef.current] ?? DIFFICULTY_CONFIG.NORMAL;
    const effectiveDelta =
      delta > 0 && !skipDifficultyScale
        ? Math.max(1, Math.round(delta * activeDiff.idsMultiplier))
        : delta;

    const prevThreat = threatLevelRef.current;
    const nextThreat = Math.max(0, Math.min(100, prevThreat + effectiveDelta));
    threatLevelRef.current = nextThreat;
    setThreatLevel(nextThreat);

    if (showToast && effectiveDelta > 0) {
      showIdsToast(effectiveDelta, reason, false);
    }

    if (prevThreat < 100 && nextThreat >= 100) {
      playErrorSfx();
      const lockdownEntry: TerminalEntry = {
        id: Date.now() + 98,
        type: 'output',
        text: `[ALERTA DE INTRUSIÓN IDS - 100%] El SOC de Allsafe ha bloqueado tu MAC (${operatorSpoofedMac}) e IP por exceso de ruido/errores. Ejecuta 'macchanger -r wlan0mon' (o 'macchanger') para rotar tu identidad de red.`,
      };
      if (targetEntries) {
        targetEntries.push(lockdownEntry);
      } else {
        setTerminalLogs((prev) => [...prev, lockdownEntry]);
      }
      pushIrcMessage(
        'romero',
        `¡¡ALERTA ROJA IDS AL 100%!! Gideon y el SOC de Allsafe acaban de bloquear tu MAC (${operatorSpoofedMac}). ¡Ejecuta "macchanger -r wlan0mon" YA para rotar tu identidad!`
      );
      triggerElliotMonologue(
        '“El IDS de Allsafe llegó al 100% y acaba de aislar mi dirección MAC en el firewall. Necesito ejecutar macchanger ahora mismo para rotar mi identidad antes de que rastreen el origen.”',
        'ALERTA DE INTRUSIÓN IDS // BLOQUEO AL 100%',
        true
      );
    }
    return nextThreat;
  };

  // Función simulateExecution para comandos de escaneo (nmap, nmap -p-, nmap -v, sqlmap, hydra, evil_portal) con incremento gradual del IDS ajustado por dificultad
  const simulateExecution = (
    cmdEchoEntry: TerminalEntry,
    finalEntries: TerminalEntry[],
    delayTime = 2000,
    onComplete?: () => void,
    scanAlertLabel = 'ESCANEO ACTIVO',
    totalIdsIncrement = 15,
    customFrames?: string[]
  ) => {
    if (execIntervalRef.current) window.clearInterval(execIntervalRef.current);
    if (execTimeoutRef.current) window.clearTimeout(execTimeoutRef.current);

    setIsExecuting(true);
    const loadingId = Date.now() + 999;
    const frames = customFrames ?? [
      '[█░░░░░░░░░] Scanning target... (Ctrl+C para abortar)',
      '[███░░░░░░░] Inyectando sondas de red... (+IDS)',
      '[██████░░░░] Procesando paquetes... (+IDS)',
      '[████████░░] Analizando respuesta... (+IDS)',
      '[██████████] Completado.',
    ];
    let frameIdx = 0;

    setTerminalLogs((prev) => [
      ...prev,
      cmdEchoEntry,
      { id: loadingId, type: 'output', text: frames[0] },
    ]);

    // Incremento gradual repartido en los pasos del escaneo escalado por la dificultad activa (o +0% si 'god_mode' está activo)
    const activeDiff = DIFFICULTY_CONFIG[difficultyRef.current] ?? DIFFICULTY_CONFIG.NORMAL;
    const scaledTotalIds = Math.max(
      1,
      Math.round(totalIdsIncrement * activeDiff.idsMultiplier)
    );
    let remainingIds = scaledTotalIds;
    const perFrameIncrement = Math.max(1, Math.round(scaledTotalIds / frames.length));
    if (godModeRemainingRef.current > 0) {
      showIdsToast(0, `GOD_MODE 0% IDS (${godModeRemainingRef.current}s)`, true);
    } else {
      showIdsToast(scaledTotalIds, scanAlertLabel, false);
    }
    const firstStepIds = Math.min(remainingIds, perFrameIncrement);
    if (firstStepIds > 0) {
      remainingIds -= firstStepIds;
      increaseIdsAlert(firstStepIds, scanAlertLabel, undefined, false, true);
    }

    const stepMs = Math.max(150, Math.floor(delayTime / frames.length));
    execIntervalRef.current = window.setInterval(() => {
      frameIdx = Math.min(frameIdx + 1, frames.length - 1);
      const stepIds =
        frameIdx === frames.length - 1
          ? remainingIds
          : Math.min(remainingIds, perFrameIncrement);
      if (stepIds > 0) {
        remainingIds -= stepIds;
        increaseIdsAlert(stepIds, scanAlertLabel, undefined, false, true);
      }
      setTerminalLogs((prev) =>
        prev.map((entry) =>
          entry.id === loadingId ? { ...entry, text: frames[frameIdx] } : entry
        )
      );
    }, stepMs);

    execTimeoutRef.current = window.setTimeout(() => {
      if (execIntervalRef.current) window.clearInterval(execIntervalRef.current);
      if (remainingIds > 0) {
        increaseIdsAlert(remainingIds, scanAlertLabel, undefined, false, true);
        remainingIds = 0;
      }
      setTerminalLogs((prev) => [
        ...prev.filter((entry) => entry.id !== loadingId),
        ...finalEntries,
      ]);
      setIsExecuting(false);
      playSuccessSfx();
      if (onComplete) {
        onComplete();
      }
    }, delayTime);
  };

  // Reproducir tono de confirmación (Sonido 2) cada vez que se avanza de paso en la máquina de estados
  useEffect(() => {
    if (
      internalStep > 0 ||
      securityStep > 0 ||
      ceoStep > 0 ||
      exteriorStep > 0 ||
      vaultStep > 0
    ) {
      playSuccessSfx();
    }
  }, [internalStep, securityStep, ceoStep, exteriorStep, vaultStep]);

  // Transición de Escena 0 a Escena 1 + Reproducción de música + Inicio de Temporizador
  const handleStartConnection = () => {
    if (sceneState !== 'SCENE_0') return;

    if (bgMusicRef.current) {
      bgMusicRef.current.muted = isMuted;
      bgMusicRef.current.volume = isMuted ? 0 : masterVolume;
      bgMusicRef.current.play().catch(() => {
        // Silenciar si el archivo mp3 local aún no está disponible
      });
    }

    setIsMissionModalOpen(false);
    setSceneState('TRANSITIONING');

    transitionTimerRef.current = window.setTimeout(() => {
      setElapsedSeconds(0);
      setCurrentPrompt('elliot@fsociety:~#');
      setWindowTitle('elliot@fsociety:~');
      setInternalStep(0);
      setSecurityStep(0);
      setCeoStep(0);
      setExteriorStep(0);
      setVaultStep(0);
      setSceneState('SCENE_1');
      saveGame({
        sceneState: 'SCENE_1',
        elapsedSeconds: 0,
        internalStep: 0,
        securityStep: 0,
        ceoStep: 0,
        camStep: 0,
        vaultStep: 0,
        currentPrompt: 'elliot@fsociety:~#',
        windowTitle: 'elliot@fsociety:~',
      });
    }, 1100);
  };

  const triggerScene2Transition = () => {
    setSceneState('SCENE_2');
    setInternalStep(0);
    setCurrentPrompt('elliot@fsociety:~/ecorp_internal#');
    setWindowTitle('elliot@fsociety:~/ecorp_internal');
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 10,
        type: 'success',
        text: '--- CONECTADO A LA SUBRED INTERNA DE ECORP (10.0.0.0/24) ---\nObjetivo: Escanea el segmento interno 10.0.0.0/24 para descubrir activos vulnerables.',
      },
    ]);
  };

  const triggerScene3Transition = () => {
    setSceneState('SCENE_3');
    setSecurityStep(0);
    setCurrentPrompt('elliot@fsociety:~/ecorp_security#');
    setWindowTitle('elliot@fsociety:~/ecorp_security');
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 20,
        type: 'success',
        text: '--- NODO DE SEGURIDAD FÍSICA DETECTADO (10.0.0.50) ---\nCredenciales SMB obtenidas: print-admin%P@ssw0rd_pr1nt — Enumera los recursos compartidos de //10.0.0.50.',
      },
    ]);
  };

  const triggerScene4Transition = () => {
    setSceneState('SCENE_4');
    setCeoStep(0);
    setCurrentPrompt('elliot@fsociety:~/ecorp_ceo_network#');
    setWindowTitle('elliot@fsociety:~/ecorp_ceo_network');
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 30,
        type: 'success',
        text: '--- SUBRED EJECUTIVA DEL CEO ALCANZADA (10.0.0.100) ---\nObjetivo: Ejecuta fuerza bruta SSH contra el usuario "ceo" en 10.0.0.100 y descifra el código de la caja fuerte.',
      },
    ]);
  };

  const triggerScene5Transition = () => {
    setSceneState('SCENE_5');
    setExteriorStep(0);
    setCurrentPrompt('elliot@fsociety:~/ecorp_exterior#');
    setWindowTitle('elliot@fsociety:~/ecorp_exterior');
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 40,
        type: 'success',
        text: '--- EXTERIOR DEL EDIFICIO ECORP (INTERFAZ INALÁMBRICA wlan0mon ACTIVA) ---\nObjetivo: Despliega el Evil Portal para capturar credenciales del guardia, desactiva la alarma perimetral y apaga la cámara IP.',
      },
    ]);
  };

  const triggerScene6Transition = () => {
    setSceneState('SCENE_6');
    setVaultStep(0);
    setCurrentPrompt('elliot@fsociety:~/ecorp_vault#');
    setWindowTitle('elliot@fsociety:~/ecorp_vault');
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now() + 50,
        type: 'success',
        text: '--- SALA ACORAZADA DE ECORP (PUERTO DE MANTENIMIENTO SERIE /dev/ttyUSB0 DETECTADO) ---\nObjetivo: Abre una conexión serie por /dev/ttyUSB0 a la caja fuerte e introduce el código maestro.',
      },
    ]);
  };

  const triggerWinScreenTransition = () => {
    setInternalStep(3);
    setSecurityStep(2);
    setCeoStep(2);
    setExteriorStep(3);
    setVaultStep(2);
    setSceneState('WIN');
  };

  const triggerWinScreen = () => {
    setSceneState('WIN');
  };

  // Limpiar localStorage y reiniciar el juego por completo
  const handleResetGameComplete = () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    if (execIntervalRef.current) window.clearInterval(execIntervalRef.current);
    if (execTimeoutRef.current) window.clearTimeout(execTimeoutRef.current);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
    currentRunIdRef.current = null;
    awardedActionsRef.current.clear();
    setIsExecuting(false);
    setElapsedSeconds(0);
    setPlayerScore(0);
    setScoreDeltaToast(null);
    setFailedAttempts(0);
    setTotalFailedAttempts(0);
    setHintsUsed(0);
    setDebugAuthUsed(false);
    setThreatLevel(0);
    threatLevelRef.current = 0;
    setIdsDeltaToast(null);
    setLogsCleared(false);
    setIsGodModeUnlocked(false);
    setGodModeSecondsLeft(0);
    godModeRemainingRef.current = 0;
    setOperatorSpoofedMac('00:C0:CA:82:1F:09');
    setTerminalLogs(INITIAL_TERMINAL_LOG);
    setCommandInput('');
    setCommandHistory([]);
    setHistoryIndex(0);
    setHistoryDraftInput('');
    setInternalStep(0);
    setSecurityStep(0);
    setCeoStep(0);
    setExteriorStep(0);
    setVaultStep(0);
    setCurrentPrompt('elliot@fsociety:~#');
    setWindowTitle('elliot@fsociety:~');
    setSceneState('SCENE_0');
  };

  // Obtener pista contextual según la escena y el paso exacto actual
  const getHintMessageForState = (): string => {
    switch (sceneState) {
      case 'SCENE_1':
        return '[Mensaje cifrado de Darlene]: Escanea primero ecorp.com con nmap para encontrar el endpoint vulnerable (/login.php?id=1) y luego inyecta con sqlmap (--dbs y --dump).';
      case 'SCENE_2':
        if (internalStep === 0) {
          return '[Mensaje cifrado de Darlene]: Estamos dentro de la subred 10.0.0.0/24. Lanza un barrido ping con nmap para descubrir el servidor de archivos.';
        }
        if (internalStep === 1) {
          return '[Mensaje cifrado de Darlene]: Busca archivos de configuración sueltos... La impresora 10.0.0.15 admite FTP anónimo.';
        }
        if (internalStep === 2) {
          return '[Mensaje cifrado de Darlene]: Lista los archivos del FTP (ls) y descarga el respaldo con get config_backup.bak.';
        }
        return '[Mensaje cifrado de Darlene]: Ya tienes las credenciales del respaldo. El salto al servidor de seguridad es automático.';
      case 'SCENE_3':
        if (securityStep === 0) {
          return '[Mensaje cifrado de Darlene]: Usa smbclient -L //10.0.0.50 -U print-admin%P@ssw0rd_pr1nt para listar las carpetas compartidas.';
        }
        if (securityStep === 1) {
          return '[Mensaje cifrado de Darlene]: Conéctate al recurso Security_Logs con smbclient //10.0.0.50/Security_Logs -U print-admin%P@ssw0rd_pr1nt.';
        }
        if (securityStep === 2 || securityStep === 3) {
          return '[Mensaje cifrado de Darlene]: Descarga access_records.csv con get y cierra smbclient con exit.';
        }
        if (securityStep === 4) {
          return '[Mensaje cifrado de Darlene]: Inspecciona access_records.csv con cat para obtener el UID hexadecimal del Jefe de Seguridad.';
        }
        return '[Mensaje cifrado de Darlene]: Clona la tarjeta con el UID de access_records.csv, tal como explica rfid_manual.txt (cat rfid_manual.txt).';
      case 'SCENE_4':
        if (ceoStep === 0) {
          return '[Mensaje cifrado de Darlene]: Ataca el SSH del CEO (10.0.0.100) usando hydra -l ceo -P rockyou.txt ssh://10.0.0.100.';
        }
        if (ceoStep === 1 || ceoStep === 1.5) {
          return '[Mensaje cifrado de Darlene]: Entra con ssh ceo@10.0.0.100 y usa la contraseña descubierta (godmode).';
        }
        if (ceoStep === 2) {
          return '[Mensaje cifrado de Darlene]: Revisa los archivos del escritorio del CEO (ls y cat safe_code.b64).';
        }
        return '[Mensaje cifrado de Darlene]: Decodifica la cadena Base64 con echo "NzM1NTYwOA==" | base64 -d.';
      case 'SCENE_5':
        if (exteriorStep === 0) {
          return '[Mensaje cifrado de Darlene]: Levanta el portal cautivo WiFi con python3 evil_portal.py --ssid "ECorp_Security".';
        }
        if (exteriorStep === 1) {
          return '[Mensaje cifrado de Darlene]: El portal ya capturó usuario y clave del guardia. Úsalos contra la API de la alarma (mira wifi_targets.txt y la salida anterior).';
        }
        if (exteriorStep === 2) {
          return '[Mensaje cifrado de Darlene]: Alarma fuera. Ahora localiza la cámara con un barrido de 192.168.99.0/24.';
        }
        if (exteriorStep === 3 || exteriorStep === 4 || exteriorStep === 5) {
          return '[Mensaje cifrado de Darlene]: Entra por telnet 192.168.99.20 con usuario root/admin y clave por defecto 12345.';
        }
        return '[Mensaje cifrado de Darlene]: Ya eres root en la cámara: detén el servicio de vídeo (service camera stop).';
      case 'SCENE_6':
        if (vaultStep === 0) {
          return '[Mensaje cifrado de Darlene]: Conéctate al puerto serie de la bóveda con minicom -D /dev/ttyUSB0 o screen /dev/ttyUSB0 9600.';
        }
        return '[Mensaje cifrado de Darlene]: Introduce el código maestro de 7 dígitos que desencriptaste del CEO (7355608).';
      default:
        return '[Mensaje cifrado de Darlene]: Mantén la calma, Elliot. Revisa la salida anterior.';
    }
  };

  // Registrar comando fallido con penalización de puntos e incremento de Alerta IDS según la dificultad seleccionada
  const registerCommandFailure = (entries: TerminalEntry[], forcePenalty = false) => {
    playErrorSfx();
    const lastEntry = entries[entries.length - 1];
    const isGenericMiss =
      !!lastEntry &&
      (lastEntry.text.startsWith('Command not recognized') || lastEntry.text === '?Invalid command');
    if (isGenericMiss && !forcePenalty) {
      lastEntry.text =
        'Comando no reconocido en este punto de la operación. Escribe "help" para ver los disponibles (no penaliza).';
      return;
    }
    const activeDiff = DIFFICULTY_CONFIG[difficultyRef.current] ?? DIFFICULTY_CONFIG.NORMAL;
    const nextFailures = failedAttempts + 1;
    setFailedAttempts(nextFailures);
    setTotalFailedAttempts((prev) => prev + 1);
    updatePlayerScore(-activeDiff.errorScorePenalty, 'ERROR DETECTADO');
    const nextThreat = increaseIdsAlert(
      activeDiff.errorIdsIncrement,
      'ERROR DE COMANDO',
      entries,
      true,
      true
    );

    if (nextThreat < 100 && nextFailures >= 4) {
      entries.push({
        id: Date.now() + 99,
        type: 'output',
        text: "[SISTEMA] Demasiados intentos fallidos. Ejecuta 'hint' para recibir asistencia de Fsociety.",
      });
      pushIrcMessage(
        'darlene',
        'Elliot, estás haciendo demasiado ruido con comandos fallidos. Respira hondo o escribe "hint" si necesitas que te pase la sintaxis.'
      );
    }
  };

  // Ejecutar rotación de identidad (macchanger / proxychains) para restablecer la Alerta de Intrusión (IDS) a 0%
  const executeMacchangerRotation = (rawCmdLabel = 'macchanger -r wlan0mon') => {
    setFailedAttempts(0);
    playSuccessSfx();
    updatePlayerScore(50, 'MAC/IP SPOOFED', 'global_macchanger');
    const randHex = () =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    const prevMac = operatorSpoofedMac;
    const newMac = `00:${randHex()}:${randHex()}:${randHex()}:${randHex()}:${randHex()}`;
    const newIpOctet = Math.floor(Math.random() * 220) + 15;
    setOperatorSpoofedMac(newMac);
    setThreatLevel(0);
    threatLevelRef.current = 0;
    showIdsToast(0, 'IDENTIDAD ROTADA', true);

    const echoText = currentPrompt ? `${currentPrompt} ${rawCmdLabel}` : rawCmdLabel;
    setTerminalLogs((prev) => [
      ...prev,
      {
        id: Date.now(),
        type: 'cmd',
        text: echoText,
      },
      {
        id: Date.now() + 1,
        type: 'success',
        text: [
          `Current MAC:   ${prevMac} (Alfa Network Wireless Adapter)`,
          `Faked MAC:     ${newMac} (Spoofed Interface wlan0mon)`,
          `[PROXYCHAINS] Dynamic SOCKS5 chain -> 127.0.0.1:9050 -> 185.220.101.${newIpOctet} [OK]`,
          '[ALERTA DE INTRUSIÓN IDS] Identidad de red rotada con éxito. Nivel de Alerta IDS restablecido a 0%.',
        ].join('\n'),
      },
    ]);
    pushIrcMessage(
      'romero',
      `Buena jugada. Nueva MAC (${newMac}) enrutada por SOCKS5. El IDS de Allsafe ha vuelto al 0%.`
    );
  };

  // Limpiar por completo el historial de comandos almacenado en el estado, reiniciando índice y borrador
  const clearTerminalCommandHistory = () => {
    setCommandHistory([]);
    setHistoryIndex(0);
    setHistoryDraftInput('');
    setCommandInput('');
    saveGame({ commandHistory: [] });
  };

  // Parser de Comandos (Escenas 1 a 6)
  const processCommand = (rawCmd: string) => {
    let trimmed = rawCmd.trim();
    if (!trimmed) return;

    const isFtpActive = sceneState === 'SCENE_2' && internalStep === 2;
    const isSmbActive = sceneState === 'SCENE_3' && (securityStep === 2 || securityStep === 3);
    const isVaultSerialActive = sceneState === 'SCENE_6' && vaultStep === 1;

    // Expansión estilo Bash: '!!' repite el último comando y '!<n>' ejecuta el comando #n del historial
    if (
      !(sceneState === 'SCENE_4' && ceoStep === 1.5) &&
      !(sceneState === 'SCENE_5' && exteriorStep === 5) &&
      !isVaultSerialActive
    ) {
      if (trimmed === '!!') {
        if (commandHistory.length === 0) {
          setTerminalLogs((prev) => [
            ...prev,
            { id: Date.now(), type: 'cmd', text: `${currentPrompt} !!` },
            { id: Date.now() + 1, type: 'output', text: 'bash: !!: event not found (historial vacío)' },
          ]);
          return;
        }
        trimmed = commandHistory[commandHistory.length - 1];
      } else if (/^!\d+$/.test(trimmed)) {
        const reqIdx = parseInt(trimmed.slice(1), 10) - 1;
        if (reqIdx < 0 || reqIdx >= commandHistory.length) {
          setTerminalLogs((prev) => [
            ...prev,
            { id: Date.now(), type: 'cmd', text: `${currentPrompt} ${trimmed}` },
            {
              id: Date.now() + 1,
              type: 'output',
              text: `bash: ${trimmed}: event not found (usa "history" para ver los índices válidos)`,
            },
          ]);
          return;
        }
        trimmed = commandHistory[reqIdx];
      }
    }

    const cmdLower = trimmed.toLowerCase();
    const isHistoryClearCmd = /^history\s+(?:-c|--clear)$/i.test(trimmed);

    // Comando 'history -c' (o 'history --clear'): limpiar completamente commandHistory, historyIndex y historyDraftInput
    // Se procesa ANTES de insertar en commandHistory para no dejar "history -c" residual ni pisar historyIndex
    if (isHistoryClearCmd && !isVaultSerialActive) {
      const removedCount = commandHistory.length;
      setFailedAttempts(0);
      playSuccessSfx();
      clearTerminalCommandHistory();
      updatePlayerScore(25, 'HISTORY CLEARED -c', 'global_history_clear');
      const echoText = currentPrompt ? `${currentPrompt} ${trimmed}` : trimmed;
      setTerminalLogs((prev) => [
        ...prev,
        { id: Date.now(), type: 'cmd', text: echoText },
        {
          id: Date.now() + 1,
          type: 'success',
          text: `[HISTORIAL] Historial de comandos vaciado por completo (${removedCount} entradas eliminadas | índice: 0 | borrador de input reiniciado).`,
        },
      ]);
      return;
    }

    // Guardar en el estado commandHistory del componente (excepto contraseñas en texto claro)
    if (
      !(sceneState === 'SCENE_4' && ceoStep === 1.5) &&
      !(sceneState === 'SCENE_5' && exteriorStep === 5)
    ) {
      const nextHistory =
        commandHistory.length > 0 && commandHistory[commandHistory.length - 1] === trimmed
          ? [...commandHistory]
          : [...commandHistory, trimmed];
      setCommandHistory(nextHistory);
      setHistoryIndex(nextHistory.length);
      setHistoryDraftInput('');
    }

    if (cmdLower === 'clear') {
      playSuccessSfx();
      setTerminalLogs([]);
      return;
    }

    // Comando 'history' para inspeccionar el historial almacenado en el estado
    if (cmdLower === 'history' && !isVaultSerialActive) {
      setFailedAttempts(0);
      playSuccessSfx();
      const echoText = currentPrompt ? `${currentPrompt} ${trimmed}` : trimmed;
      const listForDisplay =
        commandHistory.length > 0 && commandHistory[commandHistory.length - 1] === trimmed
          ? commandHistory
          : [...commandHistory, trimmed];
      const formattedHistory = listForDisplay
        .map((cmdItem, idx) => `  ${String(idx + 1).padStart(3, ' ')}  ${cmdItem}`)
        .join('\n');

      setTerminalLogs((prev) => [
        ...prev,
        { id: Date.now(), type: 'cmd', text: echoText },
        {
          id: Date.now() + 1,
          type: 'output',
          text: `${formattedHistory}\n[TIP: Usa Flecha Arriba (↑) / Abajo (↓) para navegar, !<n> / !! para repetir, o "history -c" para vaciar el historial]`,
        },
      ]);
      return;
    }

    // Comando oculto global reset_ctf para limpiar localStorage y reiniciar
    if (cmdLower === 'reset_ctf') {
      handleResetGameComplete();
      return;
    }

    // Permitir siempre la rotación de identidad (macchanger / proxychains), incluso si el IDS llegó al 100% durante un prompt de contraseña
    if (
      cmdLower === 'macchanger' ||
      cmdLower.startsWith('macchanger ') ||
      cmdLower === 'proxychains' ||
      cmdLower.startsWith('proxychains ')
    ) {
      executeMacchangerRotation(trimmed);
      return;
    }

    // Si la Alerta de Intrusión (IDS) alcanzó el 100%, forzar la rotación de identidad (macchanger) antes de procesar otros comandos
    if (
      threatLevelRef.current >= 100 &&
      godModeRemainingRef.current <= 0 &&
      !cmdLower.startsWith('debug_auth') &&
      !cmdLower.startsWith('god_mode') &&
      !cmdLower.startsWith('unlock_god') &&
      !cmdLower.startsWith('riddle') &&
      !cmdLower.startsWith('enigma') &&
      !cmdLower.startsWith('solve') &&
      cmdLower !== 'help' &&
      cmdLower !== 'hint' &&
      cmdLower !== 'help -hint' &&
      cmdLower !== 'irc' &&
      !cmdLower.startsWith('irc ')
    ) {
      playErrorSfx();
      updatePlayerScore(-25, 'FIREWALL BLOCKED');
      const echoText = currentPrompt ? `${currentPrompt} ${trimmed}` : trimmed;
      setTerminalLogs((prev) => [
        ...prev,
        { id: Date.now(), type: 'cmd', text: echoText },
        {
          id: Date.now() + 1,
          type: 'output',
          text: [
            '[!] ALERTA DE INTRUSIÓN (IDS) AL 100% — FIREWALL LOCKDOWN ACTIVO [!]',
            `Tu dirección MAC (${operatorSpoofedMac}) ha sido bloqueada por el sistema de detección de intrusos.`,
            "Ejecuta 'macchanger -r wlan0mon' (o 'macchanger') para rotar tu identidad y desbloquear la terminal.",
          ].join('\n'),
        },
      ]);
      return;
    }

    // Caso especial Paso 1.5 de Escena 4: Introducir contraseña SSH con el prompt oculto
    if (sceneState === 'SCENE_4' && ceoStep === 1.5) {
      if (trimmed === 'godmode') {
        playSuccessSfx();
        setFailedAttempts(0);
        updatePlayerScore(75, 'CEO SSH ACCESS', 's4_ssh_login');
        setTerminalLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: 'output',
            text: 'Welcome to ECorp Enterprise OS.',
          },
        ]);
        setCeoStep(2);
        setCurrentPrompt('ceo@ecorp-desktop:~$');
        setWindowTitle('ceo@ecorp-desktop:~');
      } else {
        const failEntries: TerminalEntry[] = [
          {
            id: Date.now(),
            type: 'output',
            text: "Permission denied, please try again.\nceo@10.0.0.100's password:",
          },
        ];
        registerCommandFailure(failEntries);
        setTerminalLogs((prev) => [...prev, ...failEntries]);
      }
      return;
    }

    // Caso especial Paso 4 de Escena 5: Introducir usuario Telnet (root o admin)
    if (sceneState === 'SCENE_5' && exteriorStep === 4) {
      if (cmdLower === 'root' || cmdLower === 'admin') {
        setFailedAttempts(0);
        updatePlayerScore(25, 'TELNET USER OK', 's5_telnet_user');
        setTerminalLogs((prev) => [
          ...prev,
          { id: Date.now(), type: 'cmd', text: trimmed },
          { id: Date.now() + 1, type: 'output', text: 'Password:' },
        ]);
        setExteriorStep(5);
      } else {
        const failEntries: TerminalEntry[] = [
          { id: Date.now(), type: 'cmd', text: trimmed },
          { id: Date.now() + 1, type: 'output', text: 'Login incorrect\nCam-OS login:' },
        ];
        registerCommandFailure(failEntries);
        setTerminalLogs((prev) => [...prev, ...failEntries]);
      }
      return;
    }

    // Caso especial Paso 5 de Escena 5: Introducir contraseña Telnet (12345)
    if (sceneState === 'SCENE_5' && exteriorStep === 5) {
      if (trimmed === '12345') {
        setFailedAttempts(0);
        updatePlayerScore(75, 'CAM-OS ROOT', 's5_telnet_pass');
        setTerminalLogs((prev) => [
          ...prev,
          { id: Date.now(), type: 'output', text: 'Welcome to Cam-OS.' },
        ]);
        setExteriorStep(6);
        setCurrentPrompt('root@cam-01:~#');
        setWindowTitle('root@cam-01:~');
      } else {
        const failEntries: TerminalEntry[] = [
          { id: Date.now(), type: 'output', text: 'Login incorrect\nPassword:' },
        ];
        registerCommandFailure(failEntries);
        setTerminalLogs((prev) => [...prev, ...failEntries]);
      }
      return;
    }

    const cmdEchoEntry: TerminalEntry = {
      id: Date.now(),
      type: 'cmd',
      text: `${currentPrompt} ${trimmed}`,
    };

    const newEntries: TerminalEntry[] = [cmdEchoEntry];

    // ========================================================================
    // SISTEMA DE PISTAS INTEGRADO: hint / help -hint (+3 MIN PENALIZACIÓN Y -100 PTS)
    // ========================================================================
    if (cmdLower === 'hint' || cmdLower === 'help -hint') {
      setElapsedSeconds((prev) => prev + 180);
      setHintsUsed((prev) => prev + 1);
      updatePlayerScore(-100, 'PISTA SOLICITADA');
      const hintText = getHintMessageForState();
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: hintText,
      });
      newEntries.push({
        id: Date.now() + 2,
        type: 'output',
        text: '[PENALIZACIÓN] +00:03:00 añadidos al UPTIME y -100 PTS por solicitar asistencia.',
      });
      pushIrcMessage('darlene', hintText.replace('[Mensaje cifrado de Darlene]: ', ''));
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // EASTER EGGS Y COMANDOS GLOBALES (Disponibles en cualquier escena)
    // ========================================================================
    if (cmdLower === 'irc' || cmdLower.startsWith('irc ')) {
      setFailedAttempts(0);
      playSuccessSfx();
      setIsIrcOpen(true);
      setIsIrcMinimized(false);
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: '[SISTEMA] Cliente IRC #fsociety-op abierto en primer plano.',
      });
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    if (cmdLower === 'whoami') {
      setFailedAttempts(0);
      updatePlayerScore(25, 'WHOAMI EASTER EGG', 'global_whoami');
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: 'Bonsoir, Elliot. ¿Eres un 1 o un 0?',
      });
      pushIrcMessage(
        'mr_robot',
        '¿Preguntándole a la máquina quién eres, Elliot? Tú eres el arquitecto de esta revolución.'
      );
      triggerElliotMonologue(
        '“whoami... A veces ni siquiera estoy seguro de quién escribe los comandos cuando cierro los ojos.”',
        'EASTER EGG // IDENTIDAD FRAGMENTADA',
        true
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    if (cmdLower === 'fsociety') {
      setFailedAttempts(0);
      updatePlayerScore(25, 'FSOCIETY MANIFESTO', 'global_fsociety');
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: 'Nuestra democracia ha sido hackeada.',
      });
      pushIrcMessage(
        'darlene',
        'Ese es el espíritu, hermanito. Dejemos nuestra firma en cada servidor de ECorp.'
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    if (cmdLower === 'logdump' || cmdLower.startsWith('logdump ')) {
      setFailedAttempts(0);
      playSuccessSfx();
      updatePlayerScore(30, 'SIEM LOGS AUDIT', 'global_logdump');
      newEntries.push({
        id: Date.now() + 1,
        type: 'logdump',
        text: ECORP_SYSTEM_ACCESS_LOGS,
      });
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // COMANDO 'theme <name>' (PERFILES DE COLOR DE LA TERMINAL: Matrix, Dracula, Monokai)
    // ========================================================================
    if (!isVaultSerialActive && (cmdLower === 'theme' || cmdLower.startsWith('theme '))) {
      const rawThemeArg = trimmed
        .replace(/^theme\s*/i, '')
        .trim()
        .toLowerCase()
        .replace(/^["']|["']$/g, '');

      const themeCatalog: Record<
        'matrix' | 'dracula' | 'monokai',
        { label: string; palette: string; desc: string }
      > = {
        matrix: {
          label: 'Matrix',
          palette: 'FG:#00ff41 · PROMPT:#4ade80 · ECHO:#dcfce7 · BG:#000a02',
          desc: 'Fósforo verde digital clásico de operador Fsociety / Kali.',
        },
        dracula: {
          label: 'Dracula',
          palette: 'FG:#8be9fd · PROMPT:#ff79c6 · ECHO:#bd93f9 · INPUT:#50fa7b · BG:#282a36',
          desc: 'Alto contraste nocturno en púrpura, rosa cian y verde neón.',
        },
        monokai: {
          label: 'Monokai',
          palette: 'FG:#a6e22e · PROMPT:#f92672 · ECHO:#66d9ef · INPUT:#fd971f · BG:#272822',
          desc: 'Paleta de consola táctica en verde lima, magenta, cian y ámbar.',
        },
      };

      if (!rawThemeArg || rawThemeArg === '-l' || rawThemeArg === '--list') {
        setFailedAttempts(0);
        playSuccessSfx();
        const activeMeta = themeCatalog[terminalTheme];
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            `[TERMINAL COLOR PROFILE // PERFIL ACTIVO: ${activeMeta.label.toUpperCase()}]`,
            `  • theme matrix    -> ${themeCatalog.matrix.desc} (${themeCatalog.matrix.palette})`,
            `  • theme dracula   -> ${themeCatalog.dracula.desc} (${themeCatalog.dracula.palette})`,
            `  • theme monokai   -> ${themeCatalog.monokai.desc} (${themeCatalog.monokai.palette})`,
            `Uso: theme <Matrix|Dracula|Monokai>  (Afecta exclusivamente a #kali-terminal sin alterar la estética del juego)`,
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const normalizedTheme: 'matrix' | 'dracula' | 'monokai' | null =
        rawThemeArg === 'matrix' || rawThemeArg === 'default' || rawThemeArg === 'kali'
          ? 'matrix'
          : rawThemeArg === 'dracula'
            ? 'dracula'
            : rawThemeArg === 'monokai'
              ? 'monokai'
              : null;

      if (!normalizedTheme) {
        playErrorSfx();
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            `theme: perfil de color desconocido '${rawThemeArg}'.`,
            `Perfiles soportados: Matrix, Dracula, Monokai.`,
            `Ejemplo: theme dracula   |   theme monokai   |   theme matrix`,
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      setFailedAttempts(0);
      playSuccessSfx();
      setTerminalTheme(normalizedTheme);
      try {
        window.localStorage.setItem('fsociety_terminal_theme_v1', normalizedTheme);
      } catch {
        // Ignorar errores de almacenamiento
      }
      updatePlayerScore(20, `THEME: ${normalizedTheme.toUpperCase()}`, 'global_theme_switch');

      const appliedMeta = themeCatalog[normalizedTheme];
      newEntries.push({
        id: Date.now() + 1,
        type: 'success',
        text: `[OK] Perfil de color de la terminal cambiado a '${appliedMeta.label}' (${appliedMeta.palette}).`,
      });
      pushIrcMessage(
        'darlene',
        `¿Cambiando el perfil de la consola a ${appliedMeta.label}? Queda brutal en tu terminal sin tocar el resto del entorno.`
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // COMANDO OCULTO 'god_mode' (30s DE INMUNIDAD IDS) + ACERTIJO DE DESBLOQUEO PREVIO
    // ========================================================================
    const isUnlockGodCmd = /^(?:unlock_god|riddle|enigma|solve)(?:\s+(.*))?$/i.test(trimmed);
    if (!isVaultSerialActive && isUnlockGodCmd) {
      const match = trimmed.match(/^(?:unlock_god|riddle|enigma|solve)(?:\s+(.*))?$/i);
      const rawAnswer = (match?.[1] || '').trim().toLowerCase().replace(/^["']|["']$/g, '');

      if (!rawAnswer) {
        setFailedAttempts(0);
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            '┌────────────────────────────────────────────────────────────────────────────┐',
            '│ ENIGMA CRIPTOGRÁFICO DE MR. ROBOT // DESBLOQUEO DE PROTOCOLO "god_mode"    │',
            '├────────────────────────────────────────────────────────────────────────────┤',
            '│ "En todo kernel UNIX poseo el UID 0 y ningún permiso me es negado;         │',
            '│  en el Arcade de Coney Island llevamos máscara y nos llamamos f_______.    │',
            '│  Dime quién soy en el sistema (4 letras) o el nombre de nuestra sociedad   │',
            '│  (8 letras) para desbloquear 30 segundos de inmunidad en el IDS."          │',
            '└────────────────────────────────────────────────────────────────────────────┘',
            'Uso del comando previo: unlock_god <respuesta>   (Ej: unlock_god root  |  unlock_god fsociety)',
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const validRiddleAnswers = [
        'root',
        'fsociety',
        'elliot',
        'mr_robot',
        'mrrobot',
        'zero',
        '0',
        'uid0',
        '5/9',
        'godmode',
      ];

      if (validRiddleAnswers.includes(rawAnswer)) {
        setFailedAttempts(0);
        playSuccessSfx();
        setIsGodModeUnlocked(true);
        saveGame({ isGodModeUnlocked: true });
        updatePlayerScore(100, 'RIDDLE SOLVED: GOD_MODE', 'global_unlock_god');
        newEntries.push({
          id: Date.now() + 1,
          type: 'success',
          text: [
            `[✓] ACERTIJO RESUELTO CORRECTAMENTE ("${rawAnswer.toUpperCase()}") — SELLO CRIPTOGRÁFICO VERIFICADO [✓]`,
            "[SISTEMA] El comando oculto 'god_mode' ha sido DESBLOQUEADO en el kernel.",
            "-> Ejecuta ahora 'god_mode' para deshabilitar el incremento de la barra IDS durante 30 segundos y realizar escaneos sin penalizaciones.",
          ].join('\n'),
        });
        pushIrcMessage(
          'mr_robot',
          `Bingo, kiddo. Has resuelto el acertijo ("${rawAnswer}"). Ya tienes desbloqueado el comando oculto "god_mode": lánzalo cuando quieras 30 segundos de inmunidad total frente al IDS de Allsafe.`
        );
        triggerElliotMonologue(
          '“El acertijo del viejo abrió un hook directo en el anillo 0 del kernel. Si ejecuto god_mode ahora, los sensores IDS de Allsafe quedarán ciegos durante 30 segundos.”',
          'ACERTIJO RESUELTO // GOD_MODE DESBLOQUEADO',
          false
        );
      } else {
        playErrorSfx();
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            `[✗] Respuesta incorrecta al acertijo: "${rawAnswer}".`,
            'Pista: El superusuario de UNIX con UID 0 (4 letras: r _ _ t) o el nombre de nuestro grupo hacker (8 letras: f _ _ _ _ _ _ y).',
            'Inténtalo con: unlock_god root   o   unlock_god fsociety',
          ].join('\n'),
        });
      }
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    if (!isVaultSerialActive && (cmdLower === 'god_mode' || cmdLower.startsWith('god_mode '))) {
      const inlineArg = trimmed
        .replace(/^god_mode\s*/i, '')
        .trim()
        .toLowerCase()
        .replace(/^["']|["']$/g, '');

      const unlockedViaInlineArg = [
        'root',
        'fsociety',
        'elliot',
        'mr_robot',
        'zero',
        '0',
        '5/9',
      ].includes(inlineArg);

      if (!isGodModeUnlocked && !unlockedViaInlineArg) {
        playErrorSfx();
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            "[!] ACCESO BLOQUEADO: El comando oculto 'god_mode' requiere ser desbloqueado previamente resolviendo el acertijo del Arquitecto [!]",
            '┌────────────────────────────────────────────────────────────────────────────┐',
            '│ ACERTIJO DE SEGURIDAD // PROTOCOLO ZERO-DAY (INMUNIDAD IDS 30s)            │',
            '│ "En todo kernel UNIX poseo el UID 0 y ningún permiso me es negado;         │',
            '│  en el Arcade de Coney Island llevamos máscara y nos llamamos f_______.    │',
            '│  ¿Quién soy en el sistema (4 letras) o cuál es nuestra sociedad (8)?"      │',
            '└────────────────────────────────────────────────────────────────────────────┘',
            "[COMANDO PREVIO REQUERIDO]: Ejecuta primero 'unlock_god root' (o 'unlock_god fsociety') y después ejecuta 'god_mode'.",
          ].join('\n'),
        });
        pushIrcMessage(
          'mr_robot',
          'Todavía no puedes lanzar "god_mode", Elliot. Primero desbloquéalo resolviendo el acertijo con el comando previo: "unlock_god root" (o "unlock_god fsociety").'
        );
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      // Si pasó la respuesta directamente o ya lo había desbloqueado con unlock_god
      if (!isGodModeUnlocked) {
        setIsGodModeUnlocked(true);
        saveGame({ isGodModeUnlocked: true });
      }

      setFailedAttempts(0);
      playSuccessSfx();
      setGodModeSecondsLeft(30);
      godModeRemainingRef.current = 30;
      if (threatLevelRef.current >= 100) {
        setThreatLevel(0);
        threatLevelRef.current = 0;
      }
      showIdsToast(0, 'GOD_MODE: IDS INMUNE (30s)', true);
      updatePlayerScore(75, 'GOD_MODE 30S STEALTH', 'global_god_mode_active');

      newEntries.push({
        id: Date.now() + 1,
        type: 'success',
        text: [
          '[⚡] MODO DIOS ACTIVADO (god_mode) — BARRA IDS CONGELADA DURANTE 30 SEGUNDOS [⚡]',
          '[RING-0 STEALTH CLOAK] Incremento de Alerta de Intrusión (IDS) DESHABILITADO temporalmente (30s restantes).',
          '[EFECTO] Puedes ejecutar cualquier escaneo (nmap, nmap -A, nmap -p-, nmap -v, nmap -sP, sqlmap, hydra) o comando con 0% de penalización IDS.',
        ].join('\n'),
      });
      pushIrcMessage(
        'darlene',
        '¡Modo Dios activo! Tienes exactamente 30 segundos con los sensores IDS de Allsafe congelados al 0% de incremento. ¡Escanea todo lo que necesites ahora!'
      );
      triggerElliotMonologue(
        '“Treinta segundos de invisibilidad total en la red. Mientras god_mode mantenga congelado el IDS de Allsafe, puedo lanzar todos los escaneos profundos sin dejar rastro.”',
        'GOD_MODE ACTIVO // 30s INMUNIDAD IDS',
        false
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // MONITOR DE PROCESOS EN TIEMPO REAL ('top' / 'htop') Y PROTECCIÓN EDR ('kill')
    // ========================================================================
    if (
      !isVaultSerialActive &&
      (cmdLower === 'top' ||
        cmdLower.startsWith('top ') ||
        cmdLower === 'htop' ||
        cmdLower.startsWith('htop '))
    ) {
      setFailedAttempts(0);
      playSuccessSfx();
      setTopPaused(false);

      // Parsear argumentos opcionales de 'top' (ej: top -u root, top -s mem, top -p 1337)
      const userMatch = trimmed.match(/(?:-u|--user)\s+([a-zA-Z0-9_-]+)/i);
      if (userMatch) {
        setTopUserFilter(userMatch[1].toLowerCase());
      } else {
        setTopUserFilter('ALL');
      }

      const sortMatch = trimmed.match(/(?:-s|-o|--sort)\s+(cpu|mem|pid|time|%cpu|%mem)/i);
      if (sortMatch) {
        const rawSort = sortMatch[1].toLowerCase().replace('%', '') as
          | 'cpu'
          | 'mem'
          | 'pid'
          | 'time';
        setTopSortBy(rawSort);
      }

      const pidMatch = trimmed.match(/(?:-p|--pid)\s+(\d+)/i);
      if (pidMatch) {
        setTopSelectedPid(Number(pidMatch[1]));
      }

      updatePlayerScore(35, 'TOP PROCESS MONITOR', 'global_top');
      newEntries.push({
        id: Date.now() + 1,
        type: 'top',
        text: 'ECORP_LIVE_TOP_MONITOR',
      });
      pushIrcMessage(
        'romero',
        'Mira ese panel de recursos y el proceso PID 1337 (ecorp_sec_agent) en el top... Está devorando CPU y RAM en tiempo real en los 4 núcleos. Ni se te ocurra meterle un "kill", tiene un watchdog en el kernel que disparará el IDS +40% de golpe.'
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // Detectar intentos de 'kill' / 'pkill' / 'killall' sobre el proceso crítico de seguridad de ECorp (+40% Alerta IDS)
    // Nota: Se preserva 'killall streamd' en la Escena 5 (paso >= 6) para apagar la cámara IP legítimamente.
    const isLegitCameraKillall =
      sceneState === 'SCENE_5' && exteriorStep >= 6 && /^killall\s+streamd$/i.test(trimmed);

    if (
      !isVaultSerialActive &&
      !isLegitCameraKillall &&
      /^(?:sudo\s+)?(?:kill|pkill|killall)(?:\s+.*)?$/i.test(trimmed)
    ) {
      const killArgs = trimmed
        .replace(/^(?:sudo\s+)?(?:kill|pkill|killall)\s*/i, '')
        .replace(/^(?:-[a-zA-Z0-9]+\s+)+/i, '')
        .trim();

      const targetedLabel = killArgs.length > 0 ? killArgs : '1337 (ecorp_sec_agent)';

      playErrorSfx();
      setFailedAttempts((prev) => prev + 1);
      setTotalFailedAttempts((prev) => prev + 1);
      updatePlayerScore(-40, 'EDR TAMPER DETECTED');

      // Disparar pico de CPU/RAM en el monitor 'top' en tiempo real
      setTopTelemetry((prev) => ({
        ...prev,
        secCpu: 96.4,
        secMem: 39.8,
        secResMb: 6520,
        cores: [99.4, 96.8, 91.2, 88.5],
        cpuHistory: [...prev.cpuHistory.slice(-19), 98],
        memHistory: [...prev.memHistory.slice(-19), 89],
        tamperSpikeUntil: Date.now() + 8000,
      }));

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: [
          `[!] KERNEL EDR TAMPER PROTECTION — SEÑAL DE TERMINACIÓN INTERCEPTADA [!]`,
          `bash: kill: (${targetedLabel}) -> [PID 1337: ecorp_sec_agent] - Operation not permitted (Ring-0 Watchdog Active)`,
          `[ECORP SIEM / IDS] Comportamiento altamente sospechoso detectado: Intento de finalizar proceso crítico de seguridad.`,
          `[ALERTA DE INTRUSIÓN IDS] Penalización inmediata de +40% aplicada al nivel de amenaza.`,
        ].join('\n'),
      });

      const nextThreat = increaseIdsAlert(
        40,
        'KILL PROCESO CRÍTICO (+40% IDS)',
        newEntries,
        true
      );

      if (nextThreat < 100) {
        pushIrcMessage(
          'darlene',
          `¡¿Qué haces intentando matar ${targetedLabel} con kill?! El agente EDR de ECorp (PID 1337) está anclado al kernel. Acabas de subir la Alerta IDS un +40% (ahora al ${nextThreat}%).`
        );
        triggerElliotMonologue(
          '“Mierda... Intentar matar el proceso crítico de seguridad de ECorp activó su protección anti-manipulación en el kernel. El nivel de alerta del IDS acaba de saltar un +40%.”',
          'EDR WATCHDOG // COMPORTAMIENTO SOSPECHOSO (+40% IDS)',
          true
        );
      }

      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // MECÁNICAS BLUE TEAM / CONTRA-INTRUSIÓN:
    // 1) Rotación de MAC/IP (macchanger -r wlan0mon / proxychains)
    // 2) Borrado de Huellas Pre-Extracción (shred / rm -rf /var/log/*)
    // 3) Analizador de Paquetes Simulado (tcpdump / Mini-Wireshark)
    // ========================================================================
    if (
      /^rm\s+-rf\s+\/var\/log(?:\/\*|\/auth\.log)?$/i.test(trimmed) ||
      /^shred\s+(?:-[a-zA-Z]+\s+)*\/var\/log\/(?:auth\.log|\*)$/i.test(trimmed)
    ) {
      setFailedAttempts(0);
      playSuccessSfx();
      setLogsCleared(true);
      setThreatLevel(0);
      threatLevelRef.current = 0;
      showIdsToast(0, 'LOGS BORRADOS', true);
      updatePlayerScore(150, 'GHOST OPERATOR 0% LOGS', 'global_shred');
      newEntries.push({
        id: Date.now() + 1,
        type: 'success',
        text: [
          'shred: /var/log/auth.log: pass 1/3 (random)...',
          'shred: /var/log/auth.log: pass 2/3 (000000)...',
          'shred: /var/log/auth.log: pass 3/3 (random)... removed',
          'shred: /var/log/syslog: removed | /var/log/wtmp: zeroed',
          '[✓] HUELLA FORENSE ELIMINADA (0% RASTRO EN DISCO). RANGO DESBLOQUEADO: GHOST OPERATOR.',
        ].join('\n'),
      });
      pushIrcMessage(
        'romero',
        '0% huella en /var/log/auth.log. Así se limpia una escena, fantasma. Rango Ghost Operator asegurado.'
      );
      triggerElliotMonologue(
        '“Tres pasadas de sobrescritura sobre /var/log/auth.log. Para cuando análisis forense llegue mañana, será como si nunca hubiéramos existido.”',
        'ANTI-FORENSE // GHOST OPERATOR',
        false
      );
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    if (cmdLower === 'tcpdump' || cmdLower.startsWith('tcpdump ')) {
      setFailedAttempts(0);
      playSuccessSfx();
      updatePlayerScore(40, 'PACKET SNIFFER', 'global_tcpdump');
      setIsSnifferOpen(true);
      setIsSnifferMinimized(false);
      const pkt = SNIFFER_PACKETS[selectedPacketIdx] || SNIFFER_PACKETS[4];
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: [
          'tcpdump: verbose output suppressed, use -v or -vv for full protocol decode',
          'listening on wlan0mon, link-type IEEE802_11_RADIO, capture size 262144 bytes',
          `[${pkt.id}] ${pkt.src} -> ${pkt.dst} (${pkt.proto}): ${pkt.info}`,
          pkt.hexDump,
          '[SISTEMA] Ventana flotante "Mini-Wireshark / tcpdump" abierta para inspección interactiva.',
        ].join('\n'),
      });
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // META-HACKING (DEVTOOLS F12): COMANDO OCULTO debug_auth <token>
    // ========================================================================
    if (cmdLower.startsWith('debug_auth')) {
      const parts = trimmed.split(/\s+/);
      const tokenArg = parts[1] || '';
      const storedToken = window.localStorage.getItem(DEBUG_SESSION_KEY) || DEBUG_SESSION_HASH;

      if (
        tokenArg === storedToken ||
        tokenArg === DEBUG_SESSION_HASH ||
        tokenArg === EMERGENCY_B64_KEY ||
        tokenArg === 'user_backup'
      ) {
        playSuccessSfx();
        setFailedAttempts(0);
        setDebugAuthUsed(true);
        updatePlayerScore(100, 'DEVTOOLS BACKDOOR', 'global_debug_auth');
        newEntries.push({
          id: Date.now() + 1,
          type: 'success',
          text: [
            '[!] PRIVILEGIOS DE DEPURACIÓN CONCEDIDOS (ROOT BACKDOOR ACTIVO) [!]',
            'Volcando secretos en memoria de ECorp...',
            '  • FTP Backup Creds : print-admin / P@ssw0rd_pr1nt',
            '  • RFID Chief UID   : 04:A3:9B:12 (047AB219C855)',
            '  • CEO SSH Password : godmode',
            '  • Vault Master Code: 7355608 (Base64: NzM1NTYwOA==)',
            '[ATAJO DE ADMINISTRADOR] Saltando control de seguridad del nodo actual...',
          ].join('\n'),
        });
        pushIrcMessage(
          'darlene',
          '¿Acabas de encontrar el backdoor de depuración en las DevTools (F12)? Joder, Elliot, por eso eres el líder.'
        );
        setTerminalLogs((prev) => [...prev, ...newEntries]);

        // Avanzar automáticamente a la siguiente escena como atajo de administrador
        if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = window.setTimeout(() => {
          if (sceneState === 'SCENE_1') triggerScene2Transition();
          else if (sceneState === 'SCENE_2') triggerScene3Transition();
          else if (sceneState === 'SCENE_3') triggerScene4Transition();
          else if (sceneState === 'SCENE_4') triggerScene5Transition();
          else if (sceneState === 'SCENE_5') triggerScene6Transition();
          else if (sceneState === 'SCENE_6') triggerWinScreen();
        }, 1200);
      } else {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: '[ERROR] Token de depuración inválido o ausente. Inspecciona el entorno del navegador (F12: Elementos / Consola / Application -> LocalStorage).',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
      }
      return;
    }

    // ========================================================================
    // SISTEMA DE ARCHIVOS VIRTUAL NAVEGABLE (pwd, cd, ls, ls -la, cat)
    // ========================================================================
    // Contexto de archivos visibles y ocultos según nodo y sesión
    const getVfsContext = () => {
      if (isFtpActive) {
        return {
          baseDir: '/srv/ftp/spool',
          visibleFiles: {
            'config_backup.bak':
              '# ECORP PRINT SERVER BACKUP (10.0.0.15)\nsmb_host = //10.0.0.50/Security_Logs\nsmb_user = print-admin\nsmb_pass = P@ssw0rd_pr1nt\n# Nota: Usa "get config_backup.bak" para exfiltrar este archivo.',
            'angela_moss_resume.pdf':
              '[PDF Binary Header %PDF-1.5]\nCandidate: Angela Moss — Allsafe Cybersecurity Account Executive\nAssigned Account: ECorp Quarterly Infosec Audit',
          } as Record<string, string>,
          hiddenFiles: {
            '.printer_debug.log':
              '[HP LaserJet Pro Spooler Log]\nWARN: Anonymous FTP enabled by lloyd_chung (10.0.0.10).\nBACKUP: config_backup.bak stored in root directory.',
          } as Record<string, string>,
        };
      }

      if (isSmbActive) {
        return {
          baseDir: '\\\\10.0.0.50\\Security_Logs',
          visibleFiles: {
            'access_records.csv':
              'USER,RFID_UID_HEX,STATUS\nCEO_Tyrell,04:7A:B2:19:C8:55,ACCESS_GRANTED\nGuard_Bill,04:11:8C:22:A0:01,ACCESS_GRANTED\n# Nota: Usa "get access_records.csv" y luego "exit".',
          } as Record<string, string>,
          hiddenFiles: {
            '.smb_audit.log':
              '[Samba Audit Trail - 10.0.0.50]\nShare: Security_Logs | Physical Badge Controller UID Format: MIFARE Classic 1K.\nClone syntax: proxmark3 -c "hf mf cload -f 047AB219C855"',
          } as Record<string, string>,
        };
      }

      switch (sceneState) {
        case 'SCENE_1':
          return {
            baseDir: '/root/fsociety_op',
            visibleFiles: {
              'targets.txt':
                'TARGET: ecorp.com (198.51.100.42)\nPORT: 80/tcp (Apache 2.4.58)\nVULN ENDPOINT: http://ecorp.com/login.php?id=1',
              'readme_darlene.txt':
                '[Nota de Darlene]:\nElliot, primero lanza "nmap ecorp.com". Luego enumera las bases de datos con:\n  sqlmap -u "http://ecorp.com/login.php?id=1" --dbs\nY vuelca la tabla users de ecorp_db con:\n  sqlmap -u "http://ecorp.com/login.php?id=1" -D ecorp_db -T users --dump',
            },
            hiddenFiles: {
              '.bash_history':
                'nmap ecorp.com\nsqlmap -u "http://ecorp.com/login.php?id=1" --dbs\nsqlmap -u "http://ecorp.com/login.php?id=1" -D ecorp_db -T users --dump',
              '.ssh/known_hosts':
                '10.0.0.15 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... (HP-LaserJet-Pro)\n10.0.0.50 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... (ECorp-Security-SMB)\n10.0.0.100 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... (ECorp-CEO-Desktop)',
              '.mr_robot_note.txt':
                '"El control es una ilusión, amigo. Ellos dejaron la puerta abierta en /login.php?id=1.\nPD: Si quieres 30s de inmunidad en la barra IDS con el comando oculto god_mode, primero resuelve mi acertijo ejecutando: unlock_god root (o unlock_god fsociety)."',
            },
          };
        case 'SCENE_2':
          return {
            baseDir: '/root/ecorp_internal',
            visibleFiles: {
              'subnet_notes.txt':
                'Segmento interno corporativo: 10.0.0.0/24.\nEjecuta un barrido con "nmap 10.0.0.0/24" para localizar servidores de impresión o FTP mal configurados.',
              ...(internalStep >= 3
                ? {
                    'config_backup.bak':
                      'smb_host = //10.0.0.50/Security_Logs\nsmb_user = print-admin\nsmb_pass = P@ssw0rd_pr1nt',
                  }
                : {}),
            },
            hiddenFiles: {
              '.bash_history':
                'nmap 10.0.0.0/24\nftp 10.0.0.15\n# Dentro de ftp>: ls -> get config_backup.bak',
              '.lloyd_notes.txt':
                '[Nota interna de Lloyd Chung - SysAdmin ECorp]:\n"Subí temporalmente config_backup.bak al FTP anónimo de la impresora 10.0.0.15. Contiene las credenciales de print-admin para el servidor SMB de seguridad (10.0.0.50). Borrar antes de la auditoría de Gideon."',
              '.ssh/known_hosts':
                '10.0.0.15 ftp-vsftpd-3.0.3 (Anonymous login allowed)\n10.0.0.50 smb-security-logs (print-admin%P@ssw0rd_pr1nt)',
            },
          };
        case 'SCENE_3':
          return {
            baseDir: '/root/ecorp_security',
            visibleFiles: {
              'rfid_manual.txt':
                '=== MANUAL PROXMARK3 RFID CLONING ===\n1. Enumerar recursos SMB: smbclient -L //10.0.0.50 -U print-admin%P@ssw0rd_pr1nt\n2. Conectar al recurso:   smbclient //10.0.0.50/Security_Logs -U print-admin%P@ssw0rd_pr1nt\n3. En smb: \\> ejecutar:   get access_records.csv y luego exit\n4. Clonar UID en tarjeta: proxmark3 -c "hf mf cload -f 047AB219C855"',
              ...(securityStep >= 3
                ? {
                    'access_records.csv':
                      'CEO_Tyrell, 04:7A:B2:19:C8:55, ACCESS_GRANTED',
                  }
                : {}),
            },
            hiddenFiles: {
              '.bash_history':
                'smbclient -L //10.0.0.50 -U print-admin%P@ssw0rd_pr1nt\nsmbclient //10.0.0.50/Security_Logs -U print-admin%P@ssw0rd_pr1nt\nproxmark3 -c "hf mf cload -f 047AB219C855"',
              '.gideon_audit.txt':
                '[Informe Confidencial Allsafe - Gideon Goddard]:\n"CRÍTICO: La cuenta de servicio print-admin%P@ssw0rd_pr1nt tiene permisos de lectura en //10.0.0.50/Security_Logs. El archivo access_records.csv expone en texto plano el UID MIFARE del ejecutivo Tyrell Wellick (047AB219C855)."',
              '.ssh/known_hosts':
                '10.0.0.50 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... (ECorp Physical Security Server)',
            },
          };
        case 'SCENE_4':
          if (ceoStep >= 2) {
            return {
              baseDir: '/home/ceo',
              visibleFiles: {
                'safe_code.b64': 'NzM1NTYwOA==',
                'project_washington.txt':
                  'WARNING: Fsociety malware detected in sector 4. Initiate wipe protocols.',
                'fsociety00.dat': [
                  '   .---.   .---.',
                  '  /     \\ /     \\',
                  ' | () () | () () |   [ FSOCIETY00.DAT ]',
                  '  \\  ^  / \\  ^  /',
                  '   |||||   |||||',
                  'Hello, friend. The invisible hand is at work.',
                ].join('\n'),
              },
              hiddenFiles: {
                '.bash_history':
                  'echo -n "7355608" | base64 > safe_code.b64\ncat safe_code.b64\necho "NzM1NTYwOA==" | base64 -d',
                '.tyrell_diary.txt':
                  '[Diario Privado - Tyrell Wellick]:\n"Bonsoir, Elliot. He guardado el código de anulación de la bóveda en safe_code.b64 codificado en Base64. Solo un tonto olvidaría decodificarlo con base64 -d."',
                '.ssh/known_hosts':
                  '192.168.99.10 ecorp-perimeter-alarm-api\n192.168.99.20 ecorp-cam-os-corridor-b3',
              },
            };
          }
          return {
            baseDir: '/root/ecorp_ceo_network',
            visibleFiles: {
              'rockyou.txt':
                '123456\npassword\necorp_admin\ngodmode\nqwerty\nletmein\ntrustno1',
              'target_ceo.txt':
                'Objetivo: Estación de trabajo de Tyrell Wellick (10.0.0.100)\nUsuario SSH: ceo\nDiccionario cargado: rockyou.txt',
            },
            hiddenFiles: {
              '.bash_history':
                'hydra -l ceo -P rockyou.txt ssh://10.0.0.100\nssh ceo@10.0.0.100',
              '.tyrell_profile.txt':
                '[Dossier Fsociety - Tyrell Wellick]:\n"Su ego es su mayor vulnerabilidad. Fuerza el servicio SSH con hydra -l ceo -P rockyou.txt ssh://10.0.0.100 y entra con ssh ceo@10.0.0.100."',
              '.ssh/known_hosts':
                '10.0.0.100 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ... (ceo@ecorp-desktop)',
            },
          };
        case 'SCENE_5':
          if (exteriorStep >= 6) {
            return {
              baseDir: '/root',
              visibleFiles: {
                'streamd.conf':
                  'daemon=streamd\nrtsp_port=554\nstatus=ACTIVE\n# Para detener la transmisión: "service camera stop" o "killall streamd"',
                'loop_stream.sh':
                  '#!/bin/sh\n# Congela el flujo RTSP de la cámara de seguridad\nservice camera stop',
              },
              hiddenFiles: {
                '.bash_history': 'service camera stop\nkillall streamd',
                '.firmware_notes.txt':
                  '[Cam-OS Embedded Linux v2.14]\nPara apagar el servicio de vídeo ejecuta: service camera stop',
                '.ssh/known_hosts': '192.168.99.10 alarm-controller.local',
              },
            };
          }
          return {
            baseDir: '/root/ecorp_exterior',
            visibleFiles: {
              'evil_portal.py':
                '#!/usr/bin/env python3\n# Rogue AP Captive Portal para interceptar credenciales WiFi de ECorp\n# Uso: python3 evil_portal.py --ssid "ECorp_Security"',
              'wifi_targets.txt':
                'SSID corporativo detectado: "ECorp_Security" (BSSID 00:14:22:01:23:45)\nSubred de seguridad física: 192.168.99.0/24',
            },
            hiddenFiles: {
              '.bash_history':
                'python3 evil_portal.py --ssid "ECorp_Security"\ncurl -u guard_01:Al4rm_0ff_99 -X POST http://192.168.99.10/api/alarm/disable\nnmap 192.168.99.0/24\ntelnet 192.168.99.20',
              '.guard_shift.log':
                '[Nota de Turno - Guardia Perimetral]:\n"Si salta el portal de ECorp_Security meto mi usuario guard_01 y clave Al4rm_0ff_99. La API para desarmar la alarma es POST http://192.168.99.10/api/alarm/disable."',
              '.cam_defaults.txt':
                '[Manual IoT Cámara IP 192.168.99.20]:\n"Acceso por Telnet (telnet 192.168.99.20). Usuario por defecto: root (o admin), clave: 12345. Comando de apagado: service camera stop."',
              '.ssh/known_hosts':
                '192.168.99.10 ECorp-Alarm-Controller\n192.168.99.20 ECorp-Security-Cam-01',
            },
          };
        case 'SCENE_6':
        default:
          return {
            baseDir: '/root/ecorp_vault',
            visibleFiles: {
              'vault_manual.txt':
                '=== ECORP VAULT SERIAL INTERFACE ===\nPuerto serie detectado: /dev/ttyUSB0 (9600 8N1)\nConectar con: minicom -D /dev/ttyUSB0  (o screen /dev/ttyUSB0 9600)\nIntroducir código maestro de 7 dígitos extraído del CEO.',
            },
            hiddenFiles: {
              '.bash_history':
                'minicom -D /dev/ttyUSB0\nscreen /dev/ttyUSB0 9600\n# Master Override PIN: 7355608',
              '.vault_pinout.txt':
                '[Esquema Hardware Bóveda ECorp - Romero]:\n"Elliot, pincha el adaptador USB-Serie en /dev/ttyUSB0 con minicom -D /dev/ttyUSB0. Cuando VaultOS pida el código maestro, mete el que desencriptaste del Base64 de Tyrell: 7355608."',
              '.ssh/known_hosts': '127.0.0.1 localhost (Vault Maintenance Loopback)',
            },
          };
      }
    };

    const vfs = getVfsContext();
    const currentFullDir = vfsSubdir ? `${vfs.baseDir}/${vfsSubdir}` : vfs.baseDir;

    // 1) Comando pwd
    if (cmdLower === 'pwd' && !isVaultSerialActive) {
      setFailedAttempts(0);
      playSuccessSfx();
      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: isFtpActive ? `257 "${currentFullDir}" is the current directory.` : currentFullDir,
      });
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // 2) Comando cd <dir>
    if ((cmdLower === 'cd' || cmdLower.startsWith('cd ')) && !isVaultSerialActive) {
      setFailedAttempts(0);
      const targetDir = trimmed.slice(2).trim();
      if (!targetDir || targetDir === '~' || targetDir === '..' || targetDir === '.' || targetDir === vfs.baseDir) {
        playSuccessSfx();
        setVfsSubdir('');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: `Directorio actual: ${vfs.baseDir}`,
        });
      } else if (targetDir === '.ssh' || targetDir === './.ssh' || targetDir === '~/.ssh') {
        playSuccessSfx();
        setVfsSubdir('.ssh');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: `Directorio actual: ${vfs.baseDir}/.ssh`,
        });
      } else {
        playErrorSfx();
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: `bash: cd: ${targetDir}: No such file or directory`,
        });
      }
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // 3) Comando ls / ls -la / ls -a / ls -l (cuando no es el ls básico de FTP/SMB que ya tiene su formato o cuando lleva flags -la/-a/-l)
    const lsMatch = /^ls(?:\s+(-[a-zA-Z]+))?$/i.exec(trimmed);
    if (lsMatch && !isVaultSerialActive) {
      const flags = (lsMatch[1] || '').toLowerCase();
      const showHidden = flags.includes('a');
      const showLong = flags.includes('l') || showHidden;

      // Si estamos en FTP o SMB y el usuario ejecuta "ls" sin flags, dejamos que el bloque de escena muestre su salida clásica,
      // pero si ejecuta "ls -la" / "ls -a" / "ls -l" o estamos en cualquier otra escena, mostramos el listado del VFS.
      if (!((isFtpActive || isSmbActive) && !flags)) {
        setFailedAttempts(0);
        playSuccessSfx();
        if (vfsSubdir === '.ssh') {
          const sshContent = vfs.hiddenFiles['.ssh/known_hosts'] || '';
          const lines = showLong
            ? [
                'total 12',
                'drwx------ 2 root root 4096 Nov 10 01:15 .',
                'drwxr-xr-x 5 root root 4096 Nov 10 01:15 ..',
                `-rw-r--r-- 1 root root  ${String(sshContent.length).padStart(3, ' ')} Nov 10 01:12 known_hosts`,
              ]
            : ['known_hosts'];
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: lines.join('\n'),
          });
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        const visibleNames = Object.keys(vfs.visibleFiles);
        const hiddenNames = Object.keys(vfs.hiddenFiles).map((k) =>
          k.startsWith('.ssh/') ? '.ssh' : k
        );
        const uniqueHidden = Array.from(new Set(hiddenNames));

        if (!showLong && !showHidden) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: visibleNames.join('   ') || '(directorio vacío)',
          });
        } else {
          const rows: string[] = ['total 32'];
          if (showHidden) {
            rows.push('drwxr-xr-x 5 root root 4096 Nov 10 01:20 .');
            rows.push('drwxr-xr-x 3 root root 4096 Nov 10 01:00 ..');
            uniqueHidden.forEach((hName) => {
              if (hName === '.ssh') {
                rows.push('drwx------ 2 root root 4096 Nov 10 01:10 .ssh');
              } else {
                const size = (vfs.hiddenFiles[hName] || '').length;
                rows.push(
                  `-rw------- 1 root root ${String(size).padStart(4, ' ')} Nov 10 01:14 ${hName}`
                );
              }
            });
          }
          visibleNames.forEach((vName) => {
            const size = (vfs.visibleFiles[vName] || '').length;
            rows.push(
              `-rw-r--r-- 1 root root ${String(size).padStart(4, ' ')} Nov 10 01:18 ${vName}`
            );
          });
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: rows.join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
    }

    // 4) Comando cat <archivo> global sobre el Sistema de Archivos Virtual
    if (cmdLower.startsWith('cat ') && !isVaultSerialActive) {
      const rawTarget = trimmed.slice(4).trim().replace(/^["']|["']$/g, '');
      const normalizedTarget = rawTarget.replace(/^\.\//, '').replace(/^~\//, '');

      // Buscar en archivos visibles, ocultos o dentro de .ssh
      let fileContent: string | undefined =
        vfs.visibleFiles[normalizedTarget] ?? vfs.hiddenFiles[normalizedTarget];

      if (!fileContent && vfsSubdir === '.ssh' && normalizedTarget === 'known_hosts') {
        fileContent = vfs.hiddenFiles['.ssh/known_hosts'];
      }

      if (fileContent !== undefined) {
        setFailedAttempts(0);
        playSuccessSfx();
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: fileContent,
        });
        const lowerFile = normalizedTarget.toLowerCase();
        // Si estamos en Escena 4 y el jugador hace cat safe_code.b64, avanzar ceoStep de 2 a 3
        if (sceneState === 'SCENE_4' && ceoStep === 2 && lowerFile === 'safe_code.b64') {
          setCeoStep(3);
          updatePlayerScore(50, 'VAULT B64 FOUND', 's4_cat_b64');
        }
        // Reacciones en #fsociety-irc y puntos al descubrir archivos ocultos / Easter Eggs
        if (lowerFile === '.lloyd_notes.txt') {
          updatePlayerScore(35, 'INTEL: LLOYD NOTES', 'lore_lloyd');
          pushIrcMessage(
            'romero',
            'Jajaja, ¿Lloyd dejó la contraseña de print-admin apuntada en un archivo oculto? Clásico de ECorp.'
          );
        } else if (lowerFile === '.gideon_audit.txt') {
          updatePlayerScore(35, 'INTEL: GIDEON AUDIT', 'lore_gideon');
          pushIrcMessage(
            'darlene',
            'El informe de auditoría de Gideon... Pobre tipo, advirtió a ECorp del fallo en Security_Logs y ni le hicieron caso.'
          );
        } else if (lowerFile === '.tyrell_diary.txt' || lowerFile === 'fsociety00.dat') {
          updatePlayerScore(35, 'INTEL: TYRELL FILE', `lore_${lowerFile}`);
          pushIrcMessage(
            'mr_robot',
            'Tyrell Wellick sabía que estábamos dentro. No te distraigas con sus juegos mentales, decodifica safe_code.b64.'
          );
        } else if (lowerFile === 'angela_moss_resume.pdf') {
          updatePlayerScore(35, 'INTEL: ANGELA CV', 'lore_angela');
          pushIrcMessage(
            'darlene',
            '¿El currículum de Angela en el spooler de impresión de ECorp? Déjala al margen de esto, Elliot.'
          );
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
    }

    // ========================================================================
    // COMANDO 'ping <host>': RÁFAGA DE PAQUETES ICMP SIMULADOS EN TIEMPO REAL (+2% ALERTA IDS)
    // ========================================================================
    if (/^ping\b/i.test(trimmed)) {
      if (isFtpActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: '?Invalid command (estás dentro de una sesión FTP activa. Usa "get config_backup.bak" o "exit").',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
      if (isSmbActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'SMB command not recognized inside active session (usa "get access_records.csv" o "exit").',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
      if (isVaultSerialActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'ACCESS DENIED. INVALID MASTER OVERRIDE CODE.\nENTER OVERRIDE MASTER CODE:',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const pingTokens = trimmed.split(/\s+/).slice(1);
      // Extraer el host ignorando flags opcionales como -c 4, -i 0.2, -W 1, -v
      const hostTokens: string[] = [];
      for (let i = 0; i < pingTokens.length; i++) {
        const tok = pingTokens[i];
        if (/^-[ciwWs]$/.test(tok)) {
          i++; // saltar argumento numérico del flag
          continue;
        }
        if (tok.startsWith('-')) {
          continue;
        }
        hostTokens.push(tok);
      }

      const rawHost = (hostTokens[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      if (!rawHost) {
        setFailedAttempts(0);
        const suggestedHost =
          sceneState === 'SCENE_1'
            ? 'ecorp.com'
            : sceneState === 'SCENE_2'
            ? '10.0.0.15'
            : sceneState === 'SCENE_3'
            ? '10.0.0.50'
            : sceneState === 'SCENE_4'
            ? '10.0.0.100'
            : sceneState === 'SCENE_5'
            ? '192.168.99.20'
            : '127.0.0.1';
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            'ping: usage error: Destination address required',
            `Uso: ping <host_o_ip>  (Ej: ping ${suggestedHost}, ping ecorp.com, ping 10.0.0.15, ping 10.0.0.50, ping 10.0.0.100, ping 192.168.99.20)`,
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      setFailedAttempts(0);
      const lowerHost = rawHost.toLowerCase();

      interface PingNodeProfile {
        displayHost: string;
        resolvedIp: string;
        ttl: number;
        baseRttMs: number;
        jitterMs: number;
        roleSummary: string;
        reachable: boolean;
      }

      const knownNodes: Record<string, PingNodeProfile> = {
        'ecorp.com': {
          displayHost: 'ecorp.com',
          resolvedIp: '198.51.100.42',
          ttl: 56,
          baseRttMs: 11.4,
          jitterMs: 1.8,
          roleSummary: 'Portal Corporativo Web ECorp [Apache 2.4.58 — TCP 80/443 ABIERTO]',
          reachable: true,
        },
        'www.ecorp.com': {
          displayHost: 'www.ecorp.com',
          resolvedIp: '198.51.100.42',
          ttl: 56,
          baseRttMs: 11.6,
          jitterMs: 1.9,
          roleSummary: 'Portal Corporativo Web ECorp [Apache 2.4.58 — TCP 80/443 ABIERTO]',
          reachable: true,
        },
        '198.51.100.42': {
          displayHost: '198.51.100.42',
          resolvedIp: '198.51.100.42',
          ttl: 56,
          baseRttMs: 11.2,
          jitterMs: 1.6,
          roleSummary: 'ecorp.com — Servidor Web DMZ [Endpoint /login.php?id=1]',
          reachable: true,
        },
        '198.51.100.1': {
          displayHost: '198.51.100.1',
          resolvedIp: '198.51.100.1',
          ttl: 254,
          baseRttMs: 7.4,
          jitterMs: 0.9,
          roleSummary: 'ecorp-edge-gw.dmz — Gateway de Borde Cisco ASA',
          reachable: true,
        },
        '198.51.100.10': {
          displayHost: '198.51.100.10',
          resolvedIp: '198.51.100.10',
          ttl: 64,
          baseRttMs: 9.3,
          jitterMs: 1.2,
          roleSummary: 'allsafe-waf-01.dmz — Sensor IDS/SIEM Allsafe Cybersecurity',
          reachable: true,
        },
        allsafe: {
          displayHost: 'allsafe-waf-01.dmz',
          resolvedIp: '198.51.100.10',
          ttl: 64,
          baseRttMs: 9.3,
          jitterMs: 1.2,
          roleSummary: 'allsafe-waf-01.dmz — Sensor IDS/SIEM Allsafe Cybersecurity',
          reachable: true,
        },
        '10.0.0.1': {
          displayHost: '10.0.0.1',
          resolvedIp: '10.0.0.1',
          ttl: 255,
          baseRttMs: 1.15,
          jitterMs: 0.35,
          roleSummary: 'ECorp-Internal-GW — Core Switch Subred Interna 10.0.0.0/24',
          reachable: true,
        },
        '10.0.0.10': {
          displayHost: '10.0.0.10',
          resolvedIp: '10.0.0.10',
          ttl: 128,
          baseRttMs: 1.84,
          jitterMs: 0.45,
          roleSummary: 'ECorp-Workstation-04 — Estación de Lloyd Chung (Windows 10)',
          reachable: true,
        },
        '10.0.0.15': {
          displayHost: '10.0.0.15',
          resolvedIp: '10.0.0.15',
          ttl: 64,
          baseRttMs: 2.18,
          jitterMs: 0.52,
          roleSummary: 'HP-LaserJet-M479fdw — Servidor de Impresión [FTP 21 / SMB 445 ABIERTO]',
          reachable: true,
        },
        '10.0.0.50': {
          displayHost: '10.0.0.50',
          resolvedIp: '10.0.0.50',
          ttl: 64,
          baseRttMs: 1.62,
          jitterMs: 0.4,
          roleSummary: 'ECorp-Sec-Srv-01 — Servidor de Seguridad Física & RFID [SMB //10.0.0.50/Security_Logs]',
          reachable: true,
        },
        '10.0.0.100': {
          displayHost: '10.0.0.100',
          resolvedIp: '10.0.0.100',
          ttl: 64,
          baseRttMs: 1.36,
          jitterMs: 0.32,
          roleSummary: 'ceo@ecorp-desktop — Estación Ejecutiva CEO Planta 44 [OpenSSH 22 ABIERTO]',
          reachable: true,
        },
        '192.168.99.1': {
          displayHost: '192.168.99.1',
          resolvedIp: '192.168.99.1',
          ttl: 64,
          baseRttMs: 3.12,
          jitterMs: 0.65,
          roleSummary: 'ECorp_Security — Gateway Inalámbrico Perimetral (wlan0mon)',
          reachable: true,
        },
        '192.168.99.10': {
          displayHost: '192.168.99.10',
          resolvedIp: '192.168.99.10',
          ttl: 64,
          baseRttMs: 2.48,
          jitterMs: 0.55,
          roleSummary: 'ECorp-Alarm-Controller — API de Alarma Perimetral [HTTP 80 /api/alarm/disable]',
          reachable: true,
        },
        '192.168.99.20': {
          displayHost: '192.168.99.20',
          resolvedIp: '192.168.99.20',
          ttl: 64,
          baseRttMs: 3.76,
          jitterMs: 0.78,
          roleSummary: 'ECorp-Sec-Cam-01 — Cámara IP CCTV (Cam-OS) [Telnet 23 / RTSP 554 ABIERTO]',
          reachable: true,
        },
        '127.0.0.1': {
          displayHost: '127.0.0.1',
          resolvedIp: '127.0.0.1',
          ttl: 64,
          baseRttMs: 0.042,
          jitterMs: 0.012,
          roleSummary: 'localhost — Interfaz Loopback Kali Linux (Operador Fsociety)',
          reachable: true,
        },
        localhost: {
          displayHost: 'localhost',
          resolvedIp: '127.0.0.1',
          ttl: 64,
          baseRttMs: 0.041,
          jitterMs: 0.011,
          roleSummary: 'localhost — Interfaz Loopback Kali Linux (Operador Fsociety)',
          reachable: true,
        },
        fsociety: {
          displayHost: 'arcade.fsociety.local',
          resolvedIp: '127.0.0.1',
          ttl: 64,
          baseRttMs: 0.048,
          jitterMs: 0.015,
          roleSummary: 'Nodo Coney Island Arcade — Consola Maestra Fsociety',
          reachable: true,
        },
      };

      const isCidrSubnet = /\/\d+$/.test(lowerHost);
      const cleanLookup = lowerHost.replace(/\/\d+$/, '');
      let nodeProfile: PingNodeProfile | undefined = knownNodes[cleanLookup];

      if (!nodeProfile) {
        if (cleanLookup === '10.0.0.0') {
          nodeProfile = knownNodes['10.0.0.1'];
        } else if (cleanLookup === '192.168.99.0') {
          nodeProfile = knownNodes['192.168.99.10'];
        } else if (cleanLookup === '198.51.100.0') {
          nodeProfile = knownNodes['198.51.100.42'];
        } else if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(cleanLookup)) {
          const octets = cleanLookup.split('.').map(Number);
          const validIp = octets.every((o) => o >= 0 && o <= 255);
          nodeProfile = {
            displayHost: rawHost,
            resolvedIp: cleanLookup,
            ttl: 64,
            baseRttMs: 4.6,
            jitterMs: 0.9,
            roleSummary: validIp
              ? `Host remoto en red (${cleanLookup}) — Responde a sondas ICMP Echo`
              : 'Dirección IPv4 fuera de rango',
            reachable: validIp,
          };
        } else if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanLookup)) {
          nodeProfile = {
            displayHost: rawHost,
            resolvedIp: '198.51.100.42',
            ttl: 56,
            baseRttMs: 12.4,
            jitterMs: 1.7,
            roleSummary: `Host DNS resuelto (${rawHost}) — Nodo accesible desde el túnel Fsociety`,
            reachable: true,
          };
        } else {
          nodeProfile = {
            displayHost: rawHost,
            resolvedIp: '0.0.0.0',
            ttl: 0,
            baseRttMs: 0,
            jitterMs: 0,
            roleSummary: 'Host desconocido o inalcanzable',
            reachable: false,
          };
        }
      }

      if (!nodeProfile.reachable) {
        increaseIdsAlert(2, `ICMP PING (${rawHost})`, newEntries, true);
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            `ping: ${rawHost}: Name or service not known (Destination Host Unreachable)`,
            '--- ping statistics ---',
            '4 packets transmitted, 0 received, 100% packet loss, time 3042ms',
            '[ALERTA IDS: +2% por sondas ICMP fallidas en la interfaz de red]',
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      // Generar 4 tiempos de respuesta (RTT) realistas con micro-variación
      const rtts = [0, 1, 2, 3].map(() => {
        const delta = (Math.random() * 2 - 1) * nodeProfile.jitterMs;
        const val = Math.max(0.02, nodeProfile.baseRttMs + delta);
        return nodeProfile.baseRttMs < 1 ? Number(val.toFixed(3)) : Number(val.toFixed(2));
      });
      const minRtt = Math.min(...rtts);
      const maxRtt = Math.max(...rtts);
      const avgRtt = rtts.reduce((acc, v) => acc + v, 0) / rtts.length;
      const variance = rtts.reduce((acc, v) => acc + Math.pow(v - avgRtt, 2), 0) / rtts.length;
      const mdevRtt = Math.sqrt(variance);
      const decimals = nodeProfile.baseRttMs < 1 ? 3 : 2;

      const headerLine = `PING ${nodeProfile.displayHost} (${nodeProfile.resolvedIp}) 56(84) bytes of data.${
        isCidrSubnet ? ' [Broadcast/Gateway ICMP Probe]' : ''
      }`;
      const replyLines = rtts.map(
        (rtt, idx) =>
          `64 bytes from ${nodeProfile.resolvedIp}: icmp_seq=${idx + 1} ttl=${
            nodeProfile.ttl
          } time=${rtt.toFixed(decimals)} ms`
      );

      // Frames progresivos en tiempo real para que cada paquete ICMP aparezca secuencialmente
      const pingFrames = [
        `${headerLine}\n${replyLines[0]}`,
        `${headerLine}\n${replyLines[0]}\n${replyLines[1]}`,
        `${headerLine}\n${replyLines[0]}\n${replyLines[1]}\n${replyLines[2]}`,
        `${headerLine}\n${replyLines[0]}\n${replyLines[1]}\n${replyLines[2]}\n${replyLines[3]}`,
      ];

      const activeDiffCfg = DIFFICULTY_CONFIG[difficultyRef.current] ?? DIFFICULTY_CONFIG.NORMAL;
      const effectivePingIds = Math.max(1, Math.round(2 * activeDiffCfg.idsMultiplier));

      const finalPingOutput = [
        headerLine,
        ...replyLines,
        '',
        `--- ${nodeProfile.displayHost} ping statistics ---`,
        `4 packets transmitted, 4 received, 0% packet loss, time 3004ms`,
        `rtt min/avg/max/mdev = ${minRtt.toFixed(decimals)}/${avgRtt.toFixed(
          decimals
        )}/${maxRtt.toFixed(decimals)}/${mdevRtt.toFixed(decimals)} ms`,
        `[CONECTIVIDAD EN TIEMPO REAL]: HOST ACTIVO — ${nodeProfile.roleSummary}`,
        `[TELEMETRÍA IDS]: +${effectivePingIds}% Alerta de Intrusión (Sonda ligera ICMP Echo Type 8/0)`,
      ].join('\n');

      simulateExecution(
        cmdEchoEntry,
        [
          {
            id: Date.now() + 1,
            type: 'output',
            text: finalPingOutput,
          },
        ],
        1200,
        () => {
          updatePlayerScore(20, 'ICMP PING OK', `ping_${sceneState}`);
          pushIrcMessage(
            'romero',
            `Ping ICMP hacia ${nodeProfile.displayHost} (${nodeProfile.resolvedIp}) confirmado con 0% de pérdida y latencia media de ${avgRtt.toFixed(decimals)} ms. Muy discreto (+${effectivePingIds}% IDS).`
          );
        },
        `ICMP PING ${nodeProfile.resolvedIp}`,
        2,
        pingFrames
      );
      return;
    }

    // ========================================================================
    // ESCANEO AVANZADO NMAP: 'nmap -sP' (+5% IDS), 'nmap -A' (+25% IDS), 'nmap -p-' (+20% IDS) Y 'nmap -v' (+18% IDS)
    // ========================================================================
    if (/^nmap\b/i.test(trimmed)) {
      const tokens = trimmed.split(/\s+/).slice(1);
      const hasPingScan = tokens.some(
        (t) => t.toLowerCase() === '-sp' || t.toLowerCase() === '-sn'
      );
      const hasAggressive = tokens.some(
        (t) => t === '-A' || t.toLowerCase() === '-a' || t.toLowerCase() === '-o'
      );
      const hasDeepPorts = tokens.some(
        (t) => t.toLowerCase() === '-p-' || t.toLowerCase() === '-p1-65535'
      );
      const hasVerbose = tokens.some((t) => /^-(?:v+|vv|sv)$/i.test(t));

      if (hasPingScan || hasAggressive || hasDeepPorts || hasVerbose) {
        // Verificar si estamos dentro de una sesión interactiva que no dispone de nmap (FTP, SMB, Cam-OS, Serial Vault)
        if (isFtpActive) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: '?Invalid command (estás dentro de una sesión FTP activa. Usa "get config_backup.bak").',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (isSmbActive) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'SMB command not recognized inside active session (usa "get access_records.csv" o "exit").',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (sceneState === 'SCENE_5' && exteriorStep >= 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'sh: nmap: not found on embedded Cam-OS',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (isVaultSerialActive) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'ACCESS DENIED. INVALID MASTER OVERRIDE CODE.\nENTER OVERRIDE MASTER CODE:',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        // En Escena 5 antes de apagar la alarma, bloquear el escaneo de la subred 192.168.99.0/24 igual que el nmap normal
        if (sceneState === 'SCENE_5' && exteriorStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Error: Desactiva primero la alarma perimetral (curl POST /api/alarm/disable) antes de lanzar escaneos Nmap sobre 192.168.99.0/24.',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        setFailedAttempts(0);

        // --------------------------------------------------------------------
        // MODO 1: PING SCAN RÁPIDO DE SUBRED ('nmap -sP' / 'nmap -sn') -> +5% IDS
        // --------------------------------------------------------------------
        if (hasPingScan && !hasDeepPorts && !hasAggressive) {
          const targetArg = tokens.find((t) => !t.startsWith('-')) || '';
          const defaultSubnetByScene: Record<string, string> = {
            SCENE_1: '198.51.100.0/24 [Subred DMZ ECorp]',
            SCENE_2: '10.0.0.0/24 [Subred Interna ECorp]',
            SCENE_3: '10.0.0.0/24 [Segmento Seguridad Física & RFID]',
            SCENE_4: '10.0.0.0/24 [VLAN Ejecutiva - Planta 44]',
            SCENE_5: '192.168.99.0/24 [Subred Perimetral IoT / CCTV]',
            SCENE_6: '127.0.0.0/8 + UART Bus [Cámara Acorazada ECorp]',
          };
          const resolvedSubnet =
            targetArg || defaultSubnetByScene[sceneState] || '10.0.0.0/24';

          const pingLines: string[] = [
            `Starting Nmap 7.94SVN ( https://nmap.org ) — Mode: -sP (Ping Scan / Host Discovery Only)`,
            `Initiating ARP/ICMP Echo Sweep on ${resolvedSubnet} [Spoofed MAC: ${operatorSpoofedMac}]`,
            '--------------------------------------------------------------------------------',
            'IP ADDRESS       LATENCY   MAC / VENDOR                  HOSTNAME & ROL DETECTADO',
            '--------------------------------------------------------------------------------',
          ];

          if (sceneState === 'SCENE_1') {
            pingLines.push(
              '198.51.100.1     0.008s    00:1A:A1:C0:00:01 (Cisco)     ecorp-edge-gw.dmz [Gateway Borde]',
              '198.51.100.10    0.010s    00:50:56:88:12:04 (VMware)    allsafe-waf-01.dmz [Sensor IDS Allsafe]',
              '198.51.100.42    0.011s    00:25:90:77:EC:01 (Supermicro) ecorp.com [Portal Web -> /login.php?id=1]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 3 dispositivos activos detectados (de 256 IPs en 198.51.100.0/24).',
              '  [*] Objetivo primario identificado: 198.51.100.42 (ecorp.com — HTTP/HTTPS activo)'
            );
          } else if (sceneState === 'SCENE_2') {
            pingLines.push(
              '10.0.0.1         0.001s    00:1A:A1:F0:01:01 (Cisco)     ECorp-Internal-GW [Core Switch]',
              '10.0.0.10        0.002s    3C:D9:2B:41:88:04 (HP Inc.)   ECorp-Workstation-04 [User: lloyd_chung]',
              '10.0.0.15        0.002s    00:1E:0B:88:42:10 (HP Print)  HP-LaserJet-M479fdw [FTP 21 / SMB 445 ABIERTO]',
              '10.0.0.50        0.003s    00:25:90:A4:11:C2 (Supermicro) ECorp-Physical-Security-Srv [Control RFID]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 4 dispositivos activos detectados (de 256 IPs en 10.0.0.0/24).',
              '  [*] Dispositivo vulnerable detectado: 10.0.0.15 (HP LaserJet Pro — Conecta con: ftp 10.0.0.15)'
            );
          } else if (sceneState === 'SCENE_3') {
            pingLines.push(
              '10.0.0.1         0.001s    00:1A:A1:F0:01:01 (Cisco)     ECorp-Internal-GW [Core Switch]',
              '10.0.0.15        0.002s    00:1E:0B:88:42:10 (HP Print)  HP-LaserJet-M479fdw [Pivot Anterior]',
              '10.0.0.50        0.002s    00:25:90:A4:11:C2 (Supermicro) ECorp-Physical-Security-Srv [SMB Security_Logs]',
              '10.0.0.52        0.003s    00:06:8E:12:99:FA (HID Corp)  HID-VertX-V1000 [Lector MIFARE Classic 1K]',
              '10.0.0.100       0.004s    A4:BB:6D:91:00:CC (Dell Inc.) ecorp-ceo-desktop [ Estación Tyrell Wellick ]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 5 dispositivos activos detectados (de 256 IPs en 10.0.0.0/24).',
              '  [*] Servidor de registros RFID: //10.0.0.50/Security_Logs (Usuario: print-admin)'
            );
          } else if (sceneState === 'SCENE_4') {
            pingLines.push(
              '10.0.0.1         0.001s    00:1A:A1:F0:44:01 (Cisco)     ECorp-Exec-Core-GW [Gateway Planta 44]',
              '10.0.0.100       0.002s    A4:BB:6D:91:00:CC (Dell Inc.) ecorp-ceo-desktop [SSH 22 - ceo@10.0.0.100]',
              '10.0.0.105       0.003s    00:50:56:C0:00:08 (VMware)    ecorp-vault-key-replica [Sync safe_code.b64]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 3 dispositivos activos detectados en VLAN Ejecutiva.',
              '  [*] Objetivo de fuerza bruta SSH: 10.0.0.100 (Usuario: ceo | Diccionario: rockyou.txt)'
            );
          } else if (sceneState === 'SCENE_5') {
            pingLines.push(
              '192.168.99.1     0.001s    00:14:22:01:00:01 (Ubiquiti)  ECorp-WiFi-WLC [AP SSID: ECorp_Security]',
              '192.168.99.10    0.002s    B8:27:EB:99:10:AA (RPi Found) ECorp-Alarm-Controller [API /api/alarm/disable]',
              '192.168.99.20    0.003s    44:19:B6:09:FA:20 (Hikvision) ECorp-Security-Cam-01 [Telnet 23 / RTSP 554]',
              '192.168.99.45    0.006s    00:14:22:01:23:45 (Zebra Ind) Guard-Handheld-01 [Terminal guard_01]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 4 dispositivos activos detectados (de 256 IPs en 192.168.99.0/24).',
              '  [*] Cámara IP detectada en 192.168.99.20 (Conecta con: telnet 192.168.99.20 -> root / 12345)'
            );
          } else {
            pingLines.push(
              '127.0.0.1        0.0002s   00:00:00:00:00:00 (Loopback)  kali-field-laptop [Consola Operador eliot]',
              '/dev/ttyUSB0     0.0004s   FTDI-FT232R-UART  (9600 8N1)  ECorp-VaultOS-v1.0 [Puente Serie Cerradura]',
              '10.255.255.254   0.015s    FE:ED:FA:CE:00:99 (WireGuard) Coney-Island-Arcade-GW [Uplink Fsociety]',
              '--------------------------------------------------------------------------------',
              'RESUMEN DE SUBRED: 2 nodos IP + 1 controlador serie UART activos.',
              '  [*] Puerto de mantenimiento físico listo: minicom -D /dev/ttyUSB0 (PIN Maestro: 7355608)'
            );
          }

          pingLines.push(
            '',
            'Nmap done: 256 IP addresses scanned in 0.94 seconds — [IDS NOISE: +5% ALERTA DE INTRUSIÓN]'
          );

          const pingScanFrames = [
            '[██░░░░░░░░] Enviando paquetes ARP/ICMP Echo Request (-sP)... (Ctrl+C para abortar)',
            '[████░░░░░░] Escuchando respuestas ARP de hosts en la subred local... (+1% IDS)',
            '[██████░░░░] Resolviendo fabricantes MAC (OUI) y latencias... (+1% IDS)',
            '[████████░░] Agrupando inventario de dispositivos activos... (+1% IDS)',
            '[██████████] Ping scan (-sP) completado (+5% IDS total).',
          ];

          simulateExecution(
            cmdEchoEntry,
            [
              {
                id: Date.now() + 1,
                type: 'output',
                text: pingLines.join('\n'),
              },
            ],
            1150,
            () => {
              updatePlayerScore(40, 'PING SWEEP -sP', `nmap_sp_${sceneState}`);
              if (sceneState === 'SCENE_2' && internalStep === 0) {
                setInternalStep(1);
              } else if (sceneState === 'SCENE_5' && exteriorStep === 2) {
                setExteriorStep(3);
              }
              pushIrcMessage(
                'darlene',
                `Buen barrido rápido con nmap -sP en ${sceneState}. Solo ha subido +5% la alerta del IDS y ya tienes todos los hosts activos mapeados.`
              );
            },
            'PING SCAN (-sP)',
            5,
            pingScanFrames
          );
          return;
        }

        // Determinar el nodo objetivo (explícito o por defecto según la escena actual)
        const targetArg = tokens.find((t) => !t.startsWith('-')) || '';
        const defaultTargetByScene: Record<string, string> = {
          SCENE_1: 'ecorp.com (198.51.100.42)',
          SCENE_2: '10.0.0.15 (HP-LaserJet-M479fdw / 10.0.0.0/24)',
          SCENE_3: '10.0.0.50 (ECorp-Physical-Security-Srv)',
          SCENE_4: '10.0.0.100 (ceo@ecorp-desktop)',
          SCENE_5: '192.168.99.20 (ECorp-Security-Cam-01 / 192.168.99.0/24)',
          SCENE_6: '127.0.0.1 / /dev/ttyUSB0 (VaultOS Hardware Bridge)',
        };
        const resolvedTarget = targetArg || defaultTargetByScene[sceneState] || 'ecorp.com';

        const reportLines: string[] = [
          `Starting Nmap 7.94SVN ( https://nmap.org ) — Flags: ${[
            hasAggressive ? '-A (OS Fingerprinting, Version Detection, Scripts & Traceroute)' : '',
            hasDeepPorts ? '-p- (All 65535 TCP Ports)' : '',
            hasVerbose ? '-v (Verbose Telemetry)' : '',
          ]
            .filter(Boolean)
            .join(' + ')}`,
        ];

        if (hasAggressive || hasVerbose) {
          reportLines.push(
            `NSE: Loaded ${hasAggressive ? '158' : '45'} scripts for scanning. Initiating SYN Stealth Scan, Service Probes & OS Detection.`,
            `Probing host ${resolvedTarget} [Interface: wlan0mon | Spoofed MAC: ${operatorSpoofedMac}]`
          );
        }

        if (sceneState === 'SCENE_1') {
          reportLines.push(
            'Nmap scan report for ecorp.com (198.51.100.42)',
            'Host is up, received echo-reply ttl 54 (0.011s latency).',
            'PORT      STATE    SERVICE          VERSION / TELEMETRY',
            '80/tcp    open     http             Apache httpd 2.4.58 ((Debian) OpenSSL/3.0.11 PHP/8.2.7 -> /login.php?id=1)',
            '443/tcp   open     ssl/http         Apache httpd 2.4.58 (TLSv1.3 CN=*.ecorp.com)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '3306/tcp  filtered mysql            MySQL 5.7.42-log (Backend DB: ecorp_db | Table: users)',
              '8080/tcp  open     http-proxy       Allsafe WAF Sensor v4.2 (Mode: PASSIVE_MONITOR)',
              '31337/tcp open     ecorp-debug-d    ECorp Legacy Debug Daemon v0.94 (F12 DevTools: debug_auth)'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '|_http-server-header: Apache/2.4.58 (Debian)',
              '|_http-title: ECorp Global Portal :: Employee Login (SQLi vector on ?id=1)',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: general purpose',
              'Running: Linux 5.X|6.X (98% confidence)',
              'OS CPE: cpe:/o:linux:linux_kernel:5.15.0-91-generic cpe:/o:debian:debian_linux:12',
              'OS details: Linux 5.15 - 6.1 (Debian 12 Bookworm x86_64, TCP timestamps enabled)',
              'TRACEROUTE (using port 80/tcp):',
              'HOP RTT      ADDRESS',
              '1   1.20 ms  198.51.100.1 (ecorp-edge-gw.dmz)',
              '2   11.00 ms 198.51.100.42 (ecorp.com)'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] OS CPE: cpe:/o:linux:linux_kernel:5.15 | WAF Heuristic: Time-based blind SQLi vulnerable on param "id".',
              '[VERBOSE] Next Vector: sqlmap -u "http://ecorp.com/login.php?id=1" --dbs'
            );
          }
        } else if (sceneState === 'SCENE_2') {
          reportLines.push(
            'Nmap scan report for 10.0.0.1 (ECorp-Internal-GW) — Host is up (0.002s latency).',
            'Nmap scan report for 10.0.0.10 (ECorp-Workstation-04 — User: lloyd_chung) — Host is up.',
            'Nmap scan report for 10.0.0.15 - HP LaserJet Pro MFP M479fdw:',
            'PORT      STATE  SERVICE       VERSION / TELEMETRY',
            '21/tcp    open   ftp           vsFTPd 3.0.3 (Anonymous FTP login ALLOWED -> config_backup.bak)',
            '445/tcp   open   microsoft-ds  Samba smbd 4.9.5-HP-Embedded (workgroup: ECORP_INTERNAL)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '631/tcp   open   ipp           CUPS 2.4 (Job history: angela_moss_resume.pdf)',
              '9100/tcp  open   jetdirect     HP JetDirect Raw Print (NVRAM dump contains print-admin creds)',
              '50001/tcp open   printer-diag  HP Diagnostic Shell (Note: SMB target 10.0.0.50)'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '| ftp-anon: Anonymous FTP login allowed (FTP code 230)',
              '|_-rw-r--r-- 1 0 0 2048 Nov 09 02:15 config_backup.bak [Contiene credenciales SMB]',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: printer|specialized',
              'Running: HP Embedded Linux 4.X, WindRiver VxWorks (96% confidence)',
              'OS CPE: cpe:/o:hp:laserjet_firmware:20240812 cpe:/o:linux:linux_kernel:4.14',
              'OS details: HP LaserJet Pro MFP M479fdw FutureSmart 4 Firmware (ARMv7 Cortex-A9)',
              'MAC Address: 00:1E:0B:88:42:10 (Hewlett Packard) | Network Distance: 1 hop'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] MAC Address: 00:1E:0B:88:42:10 (Hewlett Packard) | Distance: 1 hop (TTL=64).',
              '[VERBOSE] FTP Banner: 220 vsFTPd 3.0.3 — Archivo crítico detectado en raíz: config_backup.bak'
            );
          }
        } else if (sceneState === 'SCENE_3') {
          reportLines.push(
            'Nmap scan report for 10.0.0.50 (ECorp-Physical-Security-Server)',
            'Host is up, received arp-response (0.003s latency).',
            'PORT      STATE  SERVICE          VERSION / TELEMETRY',
            '139/tcp   open   netbios-ssn      Samba smbd 4.17.12-Debian (workgroup: ECORP_SEC)',
            '445/tcp   open   microsoft-ds     Samba smbd 4.17.12-Debian (Shares: print$, Security_Logs, IPC$)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '4444/tcp  open   rfid-controller  HID VertX V1000 Door Multiplexer (MIFARE Classic 1K Block 0)',
              '5985/tcp  open   wsman            Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)',
              '27015/tcp open   access-log-sync  RFID CSV Exporter -> \\\\10.0.0.50\\Security_Logs\\access_records.csv'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '| smb-os-discovery: OS: Windows 6.1 (Samba 4.17.12-Debian)',
              '|   Computer name: ecorp-sec-srv01 | Domain: ecorp.internal',
              '|_  Target Share: //10.0.0.50/Security_Logs (Auth: print-admin%P@ssw0rd_pr1nt)',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: general purpose',
              'Running: Linux 6.X (99% confidence)',
              'OS CPE: cpe:/o:debian:debian_linux:12 cpe:/o:linux:linux_kernel:6.1.0-18-amd64',
              'OS details: Debian GNU/Linux 12 (Bookworm) Kernel 6.1 (Supermicro Physical Security Node)',
              'MAC Address: 00:25:90:A4:11:C2 (Supermicro Computer) | Network Distance: 1 hop'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] MAC Address: 00:25:90:A4:11:C2 (Supermicro Computer) | SMB Signing: disabled.',
              '[VERBOSE] Credenciales válidas para //10.0.0.50/Security_Logs: print-admin%P@ssw0rd_pr1nt'
            );
          }
        } else if (sceneState === 'SCENE_4') {
          reportLines.push(
            'Nmap scan report for 10.0.0.100 (ecorp-ceo-desktop.internal — Tyrell Wellick)',
            'Host is up, received syn-ack ttl 64 (0.002s latency).',
            'PORT      STATE  SERVICE          VERSION / TELEMETRY',
            '22/tcp    open   ssh              OpenSSH 9.2p1 Debian 2+deb12u2 (protocol 2.0 | User: ceo)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '2222/tcp  closed EtherNet-IP-1    reset ttl 64',
              '8443/tcp  open   vault-key-sync   ECorp Executive Vault Sync (Local file: /home/ceo/safe_code.b64)',
              '60000/tcp open   dark-army-relay  Encrypted SOCKS Beacon (project_washington.txt / fsociety00.dat)'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '| ssh-hostkey: 256 4f:9a:1c:08:ec:0r:p9:99 (ED25519) — ceo@ecorp-desktop',
              '|_ssh-auth-methods: password, publickey [PAM Rate-Limit: DISABLED -> Hydra rockyou.txt]',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: general purpose',
              'Running: Linux 6.X (99% confidence)',
              'OS CPE: cpe:/o:linux:linux_kernel:6.5 cpe:/o:ubuntu:ubuntu_linux:23.10',
              'OS details: Linux 6.5.0-26-generic (Workstation Ejecutiva de Tyrell Wellick - x86_64)',
              'MAC Address: A4:BB:6D:91:00:CC (Dell Inc.) | Network Distance: 1 hop'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] SSH-2.0-OpenSSH_9.2p1: Sin límite de rate-limiting PAM -> Vulnerable a fuerza bruta con Hydra (rockyou.txt).',
              '[VERBOSE] Host Key SHA256: 4f:9a:1c:08:ec:0r:p9:99 (ceo@10.0.0.100)'
            );
          }
        } else if (sceneState === 'SCENE_5') {
          reportLines.push(
            'Nmap scan report for 192.168.99.10 (ECorp-Alarm-Controller) — Host is up (0.002s latency).',
            '  80/tcp    open   http           Perimeter Alarm REST API (POST /api/alarm/disable)',
            'Nmap scan report for 192.168.99.20 (ECorp-Security-Cam-01 — Corridor B3):',
            'PORT      STATE  SERVICE          VERSION / TELEMETRY',
            '23/tcp    open   telnet           BusyBox telnetd 1.35.0 (Cam-OS v2.14 — Default login: root / 12345)',
            '554/tcp   open   rtsp             Hikvision RTSP Server v5.5.82 (Active video feed: streamd)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '8000/tcp  open   hikvision-ipc    Embedded Camera Control Bus',
              '37777/tcp open   dvr-mgmt         Cam-OS Service Manager (Stop command: "service camera stop")',
              '49152/tcp open   upnp             Portable SDK for UPnP devices 1.6.19'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '|_rtsp-methods: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN (Daemon: streamd)',
              '|_telnet-ntlm-info: Cam-OS Embedded Shell (cleartext root:12345)',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: webcam|media device',
              'Running: Embedded Linux 3.X|4.X (HiSilicon ARM SoC - 97% confidence)',
              'OS CPE: cpe:/o:hikvision:ip_camera_firmware:5.5.82 cpe:/o:linux:linux_kernel:3.18',
              'OS details: Cam-OS Embedded Linux 3.18.20 (BusyBox userland — stop via "service camera stop")',
              'MAC Address: 44:19:B6:09:FA:20 (Hikvision Digital Technology) | Network Distance: 1 hop'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] MAC Address: 44:19:B6:09:FA:20 (Hikvision Digital Technology) | Telnet cleartext auth.',
              '[VERBOSE] Conecta con: telnet 192.168.99.20 -> usuario: root / pass: 12345 -> service camera stop'
            );
          }
        } else {
          reportLines.push(
            'Nmap scan report for 127.0.0.1 / /dev/ttyUSB0 (ECorp Vault Maintenance Bridge)',
            'Host is up (0.0004s latency).',
            'PORT      STATE  SERVICE          VERSION / TELEMETRY',
            '2323/tcp  open   rs232-ttyusb0    FTDI FT232R USB-UART Bridge (/dev/ttyUSB0 @ 9600 8N1 -> VaultOS v1.0)'
          );
          if (hasDeepPorts) {
            reportLines.push(
              '9999/tcp  open   vault-solenoid   Diebold-Nixdorf Electronic Lock (7-Digit Master Override PIN required)',
              '65535/tcp open   fsociety-beacon  Coney Island Arcade Exfiltration Uplink [READY]'
            );
          }
          if (hasAggressive) {
            reportLines.push(
              '|_vault-banner: ECorp VaultOS v1.0 (Diebold-Nixdorf High-Security Solenoid Controller)',
              '--- [OS FINGERPRINTING & VERSION DETECTION (-A)] ---',
              'Device type: specialized|security-misc',
              'Running: FreeRTOS 10.X / ECorp VaultOS v1.0 (95% confidence)',
              'OS CPE: cpe:/h:diebold:vault_controller:1.0 cpe:/o:amazon:freertos:10.4',
              'OS details: ECorp VaultOS v1.0 Real-Time OS on ARM Cortex-M4 (Master PIN: 7355608)',
              'Serial Interface: /dev/ttyUSB0 (9600 8N1) -> minicom -D /dev/ttyUSB0'
            );
          }
          if (hasVerbose) {
            reportLines.push(
              '[VERBOSE] Serial Controller: FTDI FT232R USB UART (/dev/ttyUSB0) | Conecta con: minicom -D /dev/ttyUSB0',
              '[VERBOSE] Master Override PIN desencriptado del CEO: 7355608'
            );
          }
        }

        const idsGain = hasAggressive
          ? 25
          : hasDeepPorts && hasVerbose
          ? 25
          : hasDeepPorts
          ? 20
          : 18;
        const scanLabel = hasAggressive
          ? 'NMAP AGGRESSIVE (-A)'
          : hasDeepPorts && hasVerbose
          ? 'NMAP FULL (-p- -v)'
          : hasDeepPorts
          ? 'ESCANEO PROFUNDO (-p-)'
          : 'NMAP VERBOSE (-v)';

        reportLines.push(
          '',
          `Read data files from: /usr/bin/../share/nmap — [IDS NOISE: +${idsGain}% ALERTA DE INTRUSIÓN]`,
          `OS and Service detection performed. Nmap done: ${
            hasDeepPorts ? '65535 ports' : '1000 ports'
          } scanned in ${hasAggressive ? '2.65' : hasDeepPorts ? '2.48' : '1.62'} seconds`
        );

        const customScanFrames = hasAggressive
          ? [
              '[█░░░░░░░░░] Iniciando escaneo agresivo Nmap -A (-O -sV -sC)... (Ctrl+C para abortar)',
              '[███░░░░░░░] Enviando sondas TCP/ICMP de OS Fingerprinting (T1-T7, ECN)... (+5% IDS)',
              '[██████░░░░] Detectando versiones exactas de servicios y demonios (-sV)... (+5% IDS)',
              '[████████░░] Ejecutando scripts NSE de auditoría y Traceroute... (+5% IDS)',
              '[██████████] OS Fingerprinting y detección de versiones completados (+25% IDS total).',
            ]
          : hasDeepPorts
          ? [
              '[█░░░░░░░░░] Iniciando escaneo profundo -p- (Puertos 1-13107)... (Ctrl+C para abortar)',
              '[███░░░░░░░] Sondeando puertos altos (13108-32768)... (+IDS)',
              '[██████░░░░] Sondeando puertos efímeros (32769-52428)... (+IDS)',
              '[████████░░] Completando barrido 52429-65535 y banners... (+IDS)',
              '[██████████] Escaneo de 65.535 puertos completado.',
            ]
          : [
              '[█░░░░░░░░░] Iniciando Nmap en modo Verbose (-v)... (Ctrl+C para abortar)',
              '[███░░░░░░░] Resolviendo ARP/DNS y huellas TCP/IP... (+IDS)',
              '[██████░░░░] Capturando banners de servicios y CPE... (+IDS)',
              '[████████░░] Ejecutando scripts NSE de diagnóstico... (+IDS)',
              '[██████████] Telemetría detallada completada.',
            ];

        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: reportLines.join('\n'),
            },
          ],
          hasAggressive ? 2400 : hasDeepPorts ? 2300 : 1850,
          () => {
            if (hasAggressive) {
              updatePlayerScore(85, 'OS FINGERPRINT -A', `nmap_a_${sceneState}`);
            } else if (hasDeepPorts && hasVerbose) {
              updatePlayerScore(95, 'NMAP DEEP+VERBOSE', `nmap_pv_${sceneState}`);
            } else if (hasDeepPorts) {
              updatePlayerScore(75, 'NMAP DEEP SCAN -p-', `nmap_p_${sceneState}`);
            } else {
              updatePlayerScore(65, 'NMAP VERBOSE -v', `nmap_v_${sceneState}`);
            }

            // Si estamos en Escena 2 (paso 0) o Escena 5 (paso 2), este escaneo avanzado también desbloquea el siguiente paso
            if (sceneState === 'SCENE_2' && internalStep === 0) {
              setInternalStep(1);
            } else if (sceneState === 'SCENE_5' && exteriorStep === 2) {
              setExteriorStep(3);
            }

            if (hasAggressive) {
              pushIrcMessage(
                'mr_robot',
                `nmap -A en ${sceneState}... Huella exacta del kernel, versión de cada demonio y ruta de paquetes. Eso sí, acabas de meter +25% de ruido directo en los sensores IDS de Allsafe. Vigila tu MAC, kiddo.`
              );
            } else if (hasDeepPorts) {
              pushIrcMessage(
                'romero',
                `Escaneo profundo (-p-) completado en ${sceneState}. Has destapado puertos altos ocultos, pero ojo: escanear los 65.535 puertos ha subido +${idsGain}% la alerta del IDS.`
              );
            } else {
              pushIrcMessage(
                'darlene',
                `Buena telemetría con nmap -v en ${sceneState}. Esos banners de versión y notas NSE te ahorrarán dar palos de ciego.`
              );
            }
          },
          scanLabel,
          idsGain,
          customScanFrames
        );
        return;
      }
    }

    // ========================================================================
    // COMANDO 'sqlmap -dump' / 'sqlmap --dump': ENUMERACIÓN DE TABLAS Y EXTRACCIÓN DE 'ecorp_db' (3s DELAY, +35% IDS)
    // ========================================================================
    if (
      /^sqlmap\b/i.test(trimmed) &&
      /(?:^|\s)(?:-dump|--dump|-d\s+ecorp_db\s+(?:-dump|--dump))\b/i.test(trimmed)
    ) {
      if (isFtpActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: '?Invalid command (estás dentro de una sesión FTP activa. Usa "get config_backup.bak" o "exit").',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
      if (isSmbActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'SMB command not recognized inside active session (usa "get access_records.csv" o "exit").',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
      if (sceneState === 'SCENE_5' && exteriorStep >= 6) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'sh: sqlmap: not found on embedded Cam-OS',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }
      if (isVaultSerialActive) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'ACCESS DENIED. INVALID MASTER OVERRIDE CODE.\nENTER OVERRIDE MASTER CODE:',
        });
        registerCommandFailure(newEntries);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      setFailedAttempts(0);
      const activeDiffCfg = DIFFICULTY_CONFIG[difficultyRef.current] ?? DIFFICULTY_CONFIG.NORMAL;
      const effectiveSqlIds = Math.max(1, Math.round(35 * activeDiffCfg.idsMultiplier));

      const sqlDumpFrames = [
        '[██░░░░░░░░] sqlmap/1.8.11#stable — Conectando a http://ecorp.com/login.php?id=1 (MySQL >= 5.0.12)... (+IDS)',
        "[████░░░░░░] [INFO] Enumerando tablas en base de datos 'ecorp_db' (4 tablas detectadas)... (+IDS)",
        "[██████░░░░] [INFO] Extrayendo filas de 'ecorp_db.users' y 'ecorp_db.internal_nodes' (UNION/Time-Based)... (+IDS)",
        "[████████░░] [INFO] Extrayendo 'ecorp_db.audit_tokens' y descifrando hashes MD5 con wordlist interna... (+IDS)",
        `[██████████] Volcado masivo de 'ecorp_db' finalizado en 3.00s — [RUIDO IDS: +${effectiveSqlIds}% ALTO VOLUMEN SQL].`,
      ];

      const dumpReportLines = [
        '        ___',
        '       __H__',
        " ___ ___[']_____ ___ ___  {1.8.11#stable}",
        '|_ -| . [.]     | .\'| . |',
        '|___|_  ["]_|_|_|__,|  _|',
        '      |_|V...       |_|   https://sqlmap.org',
        '',
        '[INFO] target URL: http://ecorp.com/login.php?id=1',
        "[INFO] fetching tables for database: 'ecorp_db'",
        '[INFO] retrieved 4 tables in database ecorp_db:',
        'Database: ecorp_db',
        '[4 tables]',
        '+------------------+',
        '| users            |',
        '| internal_nodes   |',
        '| audit_tokens     |',
        '| executive_keys   |',
        '+------------------+',
        '',
        "[INFO] fetching entries for table 'users' in database 'ecorp_db'",
        'Database: ecorp_db',
        'Table: users',
        '[3 entries]',
        '+----+-------------+---------------------+----------------+------------------+',
        '| id | username    | password_md5        | cleartext_pass | role             |',
        '+----+-------------+---------------------+----------------+------------------+',
        '| 1  | admin       | 25d55ad283aa400af46 | h4ck3d         | ecorp_superadmin |',
        '| 2  | lloyd_chung | 827ccb0eea8a706c4c3 | print_spool_99 | sysadmin_vlan10  |',
        '| 3  | gideon_g    | e10adc3949ba59abbe5 | allsafe_soc_01 | sec_auditor      |',
        '+----+-------------+---------------------+----------------+------------------+',
        '',
        "[INFO] fetching entries for table 'internal_nodes' in database 'ecorp_db'",
        'Database: ecorp_db',
        'Table: internal_nodes',
        '[3 entries]',
        '+---------------+---------------------+-------------------------+-----------------------------------+',
        '| node_ip       | hostname            | open_services           | notes                             |',
        '+---------------+---------------------+-------------------------+-----------------------------------+',
        '| 10.0.0.15     | HP-LaserJet-M479fdw | 21/FTP (anon), 445/SMB  | Spool backup: config_backup.bak   |',
        '| 10.0.0.50     | ECorp-Sec-Srv-01    | 445/SMB (Security_Logs) | Account: print-admin (ver backup) |',
        '| 10.0.0.100    | ECorp-CEO-Desktop   | 22/SSH (user: ceo)      | Vault PIN file: safe_code.b64     |',
        '+---------------+---------------------+-------------------------+-----------------------------------+',
        '',
        "[INFO] fetching entries for table 'audit_tokens' in database 'ecorp_db'",
        'Database: ecorp_db',
        'Table: audit_tokens',
        '[2 entries]',
        '+------------------+------------------------------------------+-----------------------+',
        '| subsystem        | api_endpoint                             | active_credential     |',
        '+------------------+------------------------------------------+-----------------------+',
        '| PERIMETER_ALARM  | http://192.168.99.10/api/alarm/disable   | guard_01:************ |',
        '| CCTV_CORRIDOR_B3 | telnet://192.168.99.20:23                | valores de fábrica    |',
        '+------------------+------------------------------------------+-----------------------+',
        '',
        `[INFO] table 'ecorp_db.*' dumped to CSV files under '/root/.local/share/sqlmap/output/ecorp.com/dump/ecorp_db/'`,
        `[ALERTA IDS]: +${effectiveSqlIds}% Alerta de Intrusión (418 consultas SQL de extracción masiva detectadas por Allsafe WAF en 3.00s)`,
      ].join('\n');

      const finalEntries: TerminalEntry[] = [
        {
          id: Date.now() + 1,
          type: 'output',
          text: dumpReportLines,
        },
      ];

      if (sceneState === 'SCENE_1') {
        finalEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'ACCESO CONSEGUIDO. CARGANDO SIGUIENTE NODO...',
        });
      }

      simulateExecution(
        cmdEchoEntry,
        finalEntries,
        3000,
        () => {
          updatePlayerScore(150, 'SQLi DUMP PWNED', 's1_sqlmap_dump');
          updatePlayerScore(60, 'FULL DB EXFIL -dump', 'sqlmap_full_dump_bonus');
          pushIrcMessage(
            'darlene',
            `¡Has volcado todas las tablas de ecorp_db de golpe con sqlmap -dump! Tenemos usuarios, IPs internas y tokens de auditoría, pero ese bombardeo de 418 consultas ha subido +${effectiveSqlIds}% el IDS de Allsafe.`
          );
          if (sceneState === 'SCENE_1') {
            if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
            transitionTimerRef.current = window.setTimeout(() => {
              triggerScene2Transition();
            }, 1400);
          }
        },
        'SQLMAP -DUMP (ALTO VOLUMEN SQL)',
        35,
        sqlDumpFrames
      );
      return;
    }

    // ========================================================================
    // ESCENA 1: RETO SQL INJECTION
    // ========================================================================
    if (sceneState === 'SCENE_1') {
      if (cmdLower === 'help') {
        setFailedAttempts(0);
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            'Comandos disponibles en el sistema (Nodo 01 - Web ECorp):',
            '  ping <host>     Envía ráfaga de paquetes ICMP para verificar conectividad (+2% IDS)',
            '  nmap <host>     Escanea puertos abiertos en el servidor objetivo',
            '                  Ej: nmap ecorp.com',
            '  nmap -sP        Ping Scan rápido de hosts activos en la subred (+5% IDS)',
            '  nmap -A         OS Fingerprinting, detección de versiones y scripts NSE (+25% IDS)',
            '  nmap -p-        Escaneo profundo de los 65.535 puertos TCP (+Info oculta, +20% IDS)',
            '  nmap -v         Escaneo con verbosidad extendida, versiones y pistas NSE (+18% IDS)',
            '  sqlmap -dump    Enumera las tablas y extrae todo el contenido de ecorp_db (3s, +35% IDS)',
            '  sqlmap          Herramienta de inyección SQL automatizada',
            '                  1) Enumerar bases de datos:',
            '                     sqlmap -u "http://ecorp.com/login.php?id=1" --dbs',
            '                  2) Volcar base de datos / tabla de usuarios (3s, +35% IDS):',
            '                     sqlmap -dump   (o sqlmap -u "http://ecorp.com/login.php?id=1" -D ecorp_db -T users --dump)',
            '  ls -la / cat    Explora archivos ocultos (.bash_history, .ssh/known_hosts, notas)',
            '  pwd / cd        Muestra o cambia el directorio actual del sistema',
            '  top             Monitor en tiempo real de procesos de ECorp (CPU y RAM variables)',
            '  kill <pid>      Envía señal de terminación a un proceso (¡Cuidado con PID 1337: +40% IDS!)',
            '  theme <name>    Cambia el perfil de color de la terminal (Matrix, Dracula, Monokai)',
            '  history [-c]    Muestra el historial de comandos o lo vacía por completo (history -c)',
            '  logdump         Vuelca los registros de acceso SIEM/syslog de ECorp (con scroll)',
            '  hint            Solicita una pista a Darlene (+03:00 penalización UPTIME)',
            '  whoami          Muestra identidad del operador',
            '  fsociety        Manifiesto oculto',
            '  reset_ctf       Borra el progreso guardado y reinicia el sistema',
            '  clear           Limpia la pantalla (Atajos: Tab autocompletar, Ctrl+L limpiar, Ctrl+C abortar)',
          ].join('\n'),
        });
      } else if (/^nmap\s+ecorp\.com$/i.test(trimmed)) {
        setFailedAttempts(0);
        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                'Starting Nmap 7.94SVN ( https://nmap.org )',
                'Nmap scan report for ecorp.com (198.51.100.42)',
                'Host is up (0.014s latency).',
                'PORT     STATE SERVICE VERSION',
                '80/tcp   open  http    Apache httpd 2.4.58 (Endpoint detectado: /login.php?id=1)',
                '443/tcp  open  ssl/http Apache httpd 2.4.58',
                '',
                'Nmap done: 1 IP address (1 host up) scanned in 1.18 seconds',
              ].join('\n'),
            },
          ],
          1800,
          () => {
            updatePlayerScore(50, 'RECON NMAP', 's1_nmap');
          }
        );
        return;
      } else if (
        cmdLower.startsWith('sqlmap') &&
        cmdLower.includes('ecorp.com/login.php?id=1') &&
        cmdLower.includes('--dbs')
      ) {
        setFailedAttempts(0);
        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                '[INFO] testing connection to the target URL',
                "[INFO] testing if GET parameter 'id' is dynamic",
                "[INFO] GET parameter 'id' appears to be 'MySQL >= 5.0.12 AND time-based blind' injectable",
                '[INFO] fetching database names',
                'available databases [2]:',
                '[*] ecorp_db',
                '[*] information_schema',
              ].join('\n'),
            },
          ],
          2000,
          () => {
            updatePlayerScore(75, 'SQLi ENUM DBS', 's1_sqlmap_dbs');
          }
        );
        return;
      } else {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: `Command not recognized: "${trimmed}". Escribe "help" para ver la guía.`,
        });
        registerCommandFailure(newEntries);
      }

      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // ESCENA 2: RED INTERNA (MÁQUINA DE ESTADOS ESTRICTA: internalStep)
    // ========================================================================
    if (sceneState === 'SCENE_2') {
      if (cmdLower === 'help') {
        if (internalStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en Red Interna (10.0.0.0/24):',
              '  ping <ip>                    Verifica conectividad ICMP en tiempo real (+2% IDS)',
              '  nmap -sP [10.0.0.0/24]       Ping Scan rápido de hosts activos en subred (+5% IDS)',
              '  nmap 10.0.0.0/24             Barrido estándar de red interna (+15% IDS)',
              '  nmap -A [target]             OS Fingerprinting y detección de versiones (+25% IDS)',
              '  nmap -p- [target]            Escaneo profundo de 65.535 puertos en el nodo (+20% IDS)',
              '  nmap -v [target]             Escaneo con verbosidad detallada y OUI MAC (+18% IDS)',
              '  ftp <ip>                     Conectar por FTP a un host descubierto',
              '  logdump                      Vuelca los registros de acceso SIEM de ECorp',
              '  clear                        Limpia la terminal',
            ].join('\n'),
          });
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en sesión FTP (ftp>):',
              '  ls                           Lista archivos en el directorio remoto',
              '  get config_backup.bak        Descarga el archivo de respaldo de configuración',
            ].join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const nmapInternalRegex = /^nmap\s+(?:-[a-zA-Z0-9]+\s+)*10\.0\.0\.0\/24$/i;
      if (nmapInternalRegex.test(trimmed)) {
        if (internalStep === 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: '?Invalid command (estás dentro de una sesión FTP activa).',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                'Starting Nmap 7.94SVN ( https://nmap.org )',
                'Nmap scan report for 10.0.0.1 (ECorp-Internal-GW)',
                'Host is up (0.002s latency).',
                'Nmap scan report for 10.0.0.10 (ECorp-Workstation-04)',
                'Host is up (0.004s latency).',
                'Nmap scan report for 10.0.0.15 - HP LaserJet Pro (Open Ports: 21 FTP, 445 SMB)',
                'Host is up (0.003s latency).',
                '',
                'Nmap done: 256 IP addresses (3 hosts up) scanned in 2.04 seconds',
              ].join('\n'),
            },
          ],
          2000,
          () => {
            updatePlayerScore(50, 'SUBNET SCAN', 's2_nmap');
            if (internalStep === 0) {
              setInternalStep(1);
            }
          }
        );
        return;
      }

      if (/^ftp\s+10\.0\.0\.15$/i.test(trimmed)) {
        if (internalStep < 1) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'ftp: 10.0.0.15: Host not found',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(50, 'FTP ANON LOGIN', 's2_ftp');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Connected to 10.0.0.15.\n220 (vsFTPd 3.0.3).\nName: anonymous.\n230 Login successful.',
        });
        setInternalStep(2);
        setCurrentPrompt('ftp>');
        setWindowTitle('elliot@fsociety:~/ecorp_internal (ftp 10.0.0.15)');
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (cmdLower === 'ls' || cmdLower === 'dir') {
        if (internalStep !== 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            '200 PORT command successful. Consider using PASV.',
            '150 Here comes the directory listing.',
            '-rw-r--r--    1 0        0            2048 Nov 09 02:15 config_backup.bak',
            '-rw-r--r--    1 0        0           54120 Nov 09 01:40 angela_moss_resume.pdf',
            '226 Directory send OK.',
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^get\s+config_backup\.bak$/i.test(trimmed)) {
        if (internalStep !== 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(125, 'SMB CREDS EXFIL', 's2_get_bak');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Transfer complete. File contains cleartext SMB credentials for print-admin: P@ssw0rd_pr1nt',
        });
        newEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'CREDENCIALES OBTENIDAS. PREPARANDO SALTO AL EQUIPO DE SEGURIDAD...',
        });

        setInternalStep(3);
        setCurrentPrompt('elliot@fsociety:~/ecorp_internal#');
        setWindowTitle('elliot@fsociety:~/ecorp_internal');
        setTerminalLogs((prev) => [...prev, ...newEntries]);

        if (transitionTimerRef.current) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          triggerScene3Transition();
        }, 1500);
        return;
      }

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: internalStep === 2 ? '?Invalid command' : 'Command not recognized',
      });
      registerCommandFailure(newEntries);
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // ESCENA 3: EQUIPO DE SEGURIDAD (MÁQUINA DE ESTADOS: securityStep)
    // ========================================================================
    if (sceneState === 'SCENE_3') {
      if (cmdLower === 'help') {
        if (securityStep === 2 || securityStep === 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en sesión SMB (smb: \\>):',
              '  ls                           Lista archivos del recurso compartido',
              '  get access_records.csv       Descarga e inspecciona los registros de acceso',
              '  exit                         Cierra la conexión SMB',
            ].join('\n'),
          });
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en Equipo de Seguridad (10.0.0.50):',
              '  ping 10.0.0.50               Verifica conectividad ICMP con el nodo (+2% IDS)',
              '  nmap -sP                     Ping Scan rápido de hosts activos en la subred (+5% IDS)',
              '  nmap -A                      OS Fingerprinting y versión exacta del nodo (+25% IDS)',
              '  nmap -p- / nmap -v           Escaneo profundo o detallado del servidor 10.0.0.50',
              '  smbclient -L //<host> -U <usuario>%<clave>      Lista los recursos compartidos',
              '  smbclient //<host>/<recurso> -U <usuario>%<clave>  Abre un recurso compartido',
              '  proxmark3 -c "hf mf cload -f <UID>"              Clona una tarjeta (ver rfid_manual.txt)',
              '  ls -la / cat <archivo>       Revisa las notas de este nodo',
              '  logdump',
              '  clear',
            ].join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const smbEnumRegex =
        /^smbclient\s+-l\s+(?:\/\/|\\\\)10\.0\.0\.50\/?\s+-u\s+["']?print-admin%P@ssw0rd_pr1nt["']?$/i;

      if (smbEnumRegex.test(trimmed)) {
        if (securityStep === 2 || securityStep === 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'SMB command not recognized inside active session.',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(50, 'SMB SHARE ENUM', 's3_smb_enum');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            '        Sharename       Type      Comment',
            '        ---------       ----      -------',
            '        print$          Disk      Printer Drivers',
            '        Security_Logs   Disk      ECorp Physical Access & RFID Logs',
            '        IPC$            IPC       IPC Service (ECorp Security Server)',
            'SMB1 disabled -- no workgroup available',
          ].join('\n'),
        });
        increaseIdsAlert(10, 'ENUMERACIÓN SMB', newEntries);

        if (securityStep === 0) {
          setSecurityStep(1);
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const smbConnectRegex =
        /^smbclient\s+(?:\/\/|\\\\)10\.0\.0\.50(?:\/|\\)Security_Logs\s+-u\s+["']?print-admin%P@ssw0rd_pr1nt["']?$/i;

      if (smbConnectRegex.test(trimmed)) {
        if (securityStep < 1) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'session setup failed: NT_STATUS_OBJECT_NAME_NOT_FOUND',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(50, 'SMB MOUNT OK', 's3_smb_conn');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Try "help" to get a list of possible commands.',
        });
        setSecurityStep(2);
        setCurrentPrompt('smb: \\>');
        setWindowTitle('elliot@fsociety:~/ecorp_security (smb //10.0.0.50/Security_Logs)');
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if ((cmdLower === 'ls' || cmdLower === 'dir') && (securityStep === 2 || securityStep === 3)) {
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            '  .                                   D        0  Mon Nov  9 02:10:00 2026',
            '  ..                                  D        0  Mon Nov  9 02:10:00 2026',
            '  access_records.csv                  N     2048  Mon Nov  9 02:14:22 2026',
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^get\s+access_records\.csv$/i.test(trimmed)) {
        if (securityStep !== 2 && securityStep !== 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(75, 'RFID UID DUMP', 's3_get_csv');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            'getting file \\access_records.csv of size 2048 bytes...',
            'CEO_Tyrell, 04:7A:B2:19:C8:55, ACCESS_GRANTED',
          ].join('\n'),
        });
        setSecurityStep(3);
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (cmdLower === 'exit' || cmdLower === 'quit') {
        if (securityStep === 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Aún no has descargado access_records.csv.',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (securityStep !== 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        setSecurityStep(4);
        setCurrentPrompt('elliot@fsociety:~/ecorp_security#');
        setWindowTitle('elliot@fsociety:~/ecorp_security');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Conexión SMB cerrada.',
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const proxmarkRegex =
        /^proxmark3\s+-c\s+["']hf\s+mf\s+cload\s+-f\s+(?:047ab219c855|04:7a:b2:19:c8:55)["']$/i;

      if (proxmarkRegex.test(trimmed)) {
        if (securityStep < 4) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text:
              securityStep === 2 || securityStep === 3
                ? 'Debes cerrar primero la sesión SMB con "exit".'
                : 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(150, 'TYRELL RFID CLONED', 's3_proxmark');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Loading block 0... OK. Magic tag successfully written.',
        });
        newEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'TARJETA CLONADA. ACCESO FÍSICO GARANTIZADO. CARGANDO SIGUIENTE FASE...',
        });
        pushIrcMessage(
          'darlene',
          '¡¡BOOM!! ¿Acabas de clonar la tarjeta MIFARE de Tyrell Wellick (04:7A:B2:19:C8:55)? Ese psicópata trajeado ni se imagina que llevamos su llave maestra.'
        );
        pushIrcMessage(
          'romero',
          'Bloque 0 grabado limpio en la tarjeta mágica con el Proxmark3. Los lectores de la planta ejecutiva te abrirán de par en par.'
        );
        triggerElliotMonologue(
          '“04:7A:B2:19:C8:55. Para los sensores magnéticos de ECorp, ahora mismo soy Tyrell Wellick. Qué frágil es una identidad cuando cabe en 6 bytes.”',
          'ROBO DE IDENTIDAD // UID TYRELL WELLICK CLONADO',
          false
        );
        setSecurityStep(5);
        setTerminalLogs((prev) => [...prev, ...newEntries]);

        if (transitionTimerRef.current) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          triggerScene4Transition();
        }, 1500);
        return;
      }

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text:
          securityStep === 2 || securityStep === 3
            ? 'SMB command not recognized'
            : 'Command not recognized',
      });
      registerCommandFailure(newEntries);
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // ESCENA 4: ATAQUE AL CEO (MÁQUINA DE ESTADOS: ceoStep + EASTER EGGS)
    // ========================================================================
    if (sceneState === 'SCENE_4') {
      if (cmdLower === 'help') {
        if (ceoStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en Red Ejecutiva del CEO (10.0.0.100):',
              '  ping 10.0.0.100              Verifica conectividad ICMP con el nodo del CEO (+2% IDS)',
              '  nmap -sP                     Ping Scan rápido de dispositivos en VLAN Ejecutiva (+5% IDS)',
              '  nmap -A                      OS Fingerprinting y versión SSH de 10.0.0.100 (+25% IDS)',
              '  nmap -p- / nmap -v           Escaneo profundo (1-65535) o verbose de 10.0.0.100',
              '  hydra -l ceo -P rockyou.txt ssh://10.0.0.100',
              '  ssh ceo@10.0.0.100',
              '  logdump',
              '  clear',
            ].join('\n'),
          });
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en el equipo del CEO (ceo@ecorp-desktop:~$):',
              '  ls',
              '  cat safe_code.b64',
              '  cat project_washington.txt',
              '  cat fsociety00.dat',
              '  echo "NzM1NTYwOA==" | base64 -d',
              '  logdump',
            ].join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const isHydraCmd =
        /^hydra\b/i.test(trimmed) &&
        /-l\s+ceo\b/i.test(trimmed) &&
        /-p\s+rockyou\.txt\b/i.test(trimmed) &&
        /(?:ssh:\/\/10\.0\.0\.100|10\.0\.0\.100\s+ssh)\b/i.test(trimmed);

      if (isHydraCmd) {
        if (ceoStep >= 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'bash: hydra: command not found on remote host',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                'Hydra v9.5 (c) 2026 by van Hauser/THC - Starting attack on ssh://10.0.0.100:22/',
                '[DATA] max 16 tasks per 1 server, overall 16 tasks, 14344399 login tries',
                '[ATTEMPT] target 10.0.0.100 - login "ceo" - pass "123456" - 1 of 14344399',
                '[ATTEMPT] target 10.0.0.100 - login "ceo" - pass "password" - 2 of 14344399',
                '[ATTEMPT] target 10.0.0.100 - login "ceo" - pass "ecorp_admin" - 3 of 14344399',
                '[22][ssh] host: 10.0.0.100   login: ceo   password: godmode',
                '1 of 1 target successfully completed, 1 valid password found',
              ].join('\n'),
            },
          ],
          2200,
          () => {
            updatePlayerScore(100, 'SSH BRUTEFORCE', 's4_hydra');
            if (ceoStep === 0) {
              setCeoStep(1);
            }
          }
        );
        return;
      }

      if (/^ssh\s+ceo@10\.0\.0\.100$/i.test(trimmed)) {
        if (ceoStep < 1) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Permission denied (publickey,password).',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (ceoStep >= 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Ya te encuentras conectado a ceo@ecorp-desktop.',
          });
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: "ceo@10.0.0.100's password:",
        });
        setCeoStep(1.5);
        setCurrentPrompt('');
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (cmdLower === 'ls' || cmdLower === 'dir') {
        if (ceoStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'safe_code.b64   project_washington.txt   fsociety00.dat',
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^cat\s+project_washington\.txt$/i.test(trimmed)) {
        if (ceoStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(35, 'INTEL: WASHINGTON', 'lore_washington');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'WARNING: Fsociety malware detected in sector 4. Initiate wipe protocols.',
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^cat\s+fsociety00\.dat$/i.test(trimmed)) {
        if (ceoStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(35, 'INTEL: FSOCIETY00.DAT', 'lore_fsociety00.dat');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            '   .---.   .---.',
            '  /     \\ /     \\',
            ' | () () | () () |   [ FSOCIETY00.DAT ]',
            '  \\  ^  / \\  ^  /',
            '   |||||   |||||',
            'Hello, friend. The invisible hand is at work.',
          ].join('\n'),
        });
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^cat\s+safe_code\.b64$/i.test(trimmed)) {
        if (ceoStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(50, 'VAULT B64 FOUND', 's4_cat_b64');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'NzM1NTYwOA==',
        });
        if (ceoStep === 2) {
          setCeoStep(3);
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const base64DecodeRegex =
        /^(?:echo\s+["']?NzM1NTYwOA==["']?\s*\|\s*base64\s+(?:-d|--decode)|base64\s+(?:-d|--decode)\s+safe_code\.b64)$/i;

      if (base64DecodeRegex.test(trimmed)) {
        if (ceoStep < 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text:
              ceoStep === 2
                ? 'Lee primero el contenido de safe_code.b64 usando "cat safe_code.b64".'
                : 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(125, 'MASTER PIN DECODED', 's4_b64_decode');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: '7355608',
        });
        newEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'CÓDIGO DE CAJA FUERTE DESCIFRADO. INICIANDO INCURSIÓN FÍSICA A LAS INSTALACIONES...',
        });
        setCeoStep(4);
        setTerminalLogs((prev) => [...prev, ...newEntries]);

        if (transitionTimerRef.current) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          triggerScene5Transition();
        }, 1500);
        return;
      }

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: 'Command not recognized',
      });
      registerCommandFailure(newEntries);
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // ESCENA 5: EXTERIORES (EVIL PORTAL, ALARMA Y CÁMARA - exteriorStep)
    // ========================================================================
    if (sceneState === 'SCENE_5') {
      if (cmdLower === 'help') {
        if (exteriorStep < 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles (Escena 5 - Exteriores ECorp):',
              '  ping 192.168.99.20           Verifica conectividad ICMP con alarma/cámara (+2% IDS)',
              '  python3 evil_portal.py --ssid "ECorp_Security"',
              '  curl -u <usuario>:<clave> -X POST <url de la API de la alarma>',
              '  ls -la / cat <archivo>       Revisa las notas de este nodo',
              '  nmap -sP [192.168.99.0/24]   Ping Scan rápido de dispositivos IoT/CCTV (+5% IDS)',
              '  nmap 192.168.99.0/24         Barrido estándar de subred perimetral (+15% IDS)',
              '  nmap -A [192.168.99.20]      OS Fingerprinting y versiones de Cam-OS (+25% IDS)',
              '  nmap -p- / nmap -v           Escaneo profundo o verbose de dispositivos IoT',
              '  telnet 192.168.99.20',
              '  logdump',
              '  clear',
            ].join('\n'),
          });
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles en Cam-OS (root@cam-01:~#):',
              '  service camera stop',
              '  killall streamd',
              '  clear',
            ].join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const evilPortalRegex =
        /^python3?\s+(?:\.\/)?evil_portal\.py\s+(?:--ssid|-s)\s+["']?ECorp_Security["']?$/i;

      if (evilPortalRegex.test(trimmed)) {
        if (exteriorStep >= 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'sh: python3: not found on Cam-OS',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                "Starting Rogue AP on wlan0mon... [OK]. Broadcasting SSID 'ECorp_Security'... [OK]. Waiting for victims...",
                '[!] Client connected (MAC: 00:14:22:01:23:45).',
                '[!] Credentials captured: guard_01 / Al4rm_0ff_99',
                '[TCPDUMP] Trama HTTP POST capturada en vivo -> Abriendo analizador de paquetes...',
                'Shutting down portal...',
              ].join('\n'),
            },
          ],
          2000,
          () => {
            updatePlayerScore(100, 'EVIL PORTAL MITM', 's5_evil_portal');
            setSelectedPacketIdx(4);
            setIsSnifferOpen(true);
            setIsSnifferMinimized(false);
            if (exteriorStep === 0) {
              setExteriorStep(1);
            }
          }
        );
        return;
      }

      const isCurlAlarmCmd =
        /^curl\b/i.test(trimmed) &&
        /-u\s+["']?guard_01:Al4rm_0ff_99["']?/i.test(trimmed) &&
        /(?:-x|--request)\s+post\b/i.test(trimmed) &&
        /https?:\/\/192\.168\.99\.10\/api\/alarm\/disable\b/i.test(trimmed);

      if (isCurlAlarmCmd) {
        if (exteriorStep < 1) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: '{"status": "error", "message": "401 Unauthorized: Invalid or missing credentials"}',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (exteriorStep >= 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'sh: curl: not found on Cam-OS',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(100, 'ALARM DISABLED', 's5_curl_alarm');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: '{"status": "success", "message": "Perimeter alarm system offline"}',
        });
        newEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'ALARMA PERIMETRAL DESACTIVADA. INICIANDO RECONOCIMIENTO DE CÁMARAS...',
        });

        if (exteriorStep === 1) {
          setExteriorStep(2);
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const nmapCamRegex = /^nmap\s+(?:-[a-zA-Z0-9]+\s+)*192\.168\.99\.0\/24$/i;
      if (nmapCamRegex.test(trimmed)) {
        if (exteriorStep < 2) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Error: Desactiva primero la alarma perimetral antes de escanear la subred 192.168.99.0/24.',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (exteriorStep >= 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'sh: nmap: not found on Cam-OS',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        simulateExecution(
          cmdEchoEntry,
          [
            {
              id: Date.now() + 1,
              type: 'output',
              text: [
                'Starting Nmap 7.94SVN ( https://nmap.org )',
                'Nmap scan report for 192.168.99.10 (ECorp-Alarm-Controller)',
                'Host is up (0.002s latency).',
                'Nmap scan report for 192.168.99.20 - ECorp Security Cam (Ports: 23 telnet, 554 rtsp)',
                'Host is up (0.004s latency).',
                'Nmap done: 256 IP addresses (2 hosts up) scanned in 1.54 seconds',
              ].join('\n'),
            },
          ],
          1800,
          () => {
            updatePlayerScore(50, 'IOT SUBNET SCAN', 's5_nmap');
            if (exteriorStep === 2) {
              setExteriorStep(3);
            }
          }
        );
        return;
      }

      if (/^telnet\s+192\.168\.99\.20$/i.test(trimmed)) {
        if (exteriorStep < 3) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'telnet: Unable to connect to remote host: Host not found',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }
        if (exteriorStep >= 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Ya te encuentras conectado a Cam-OS (root@cam-01).',
          });
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(50, 'TELNET CONNECTED', 's5_telnet_conn');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Connected to 192.168.99.20. Cam-OS login:',
        });
        setExteriorStep(4);
        setCurrentPrompt('');
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (/^(?:service\s+camera\s+stop|killall\s+streamd)$/i.test(trimmed)) {
        if (exteriorStep < 6) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Command not recognized',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(125, 'CCTV STREAM STOPPED', 's5_cam_stop');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: 'Stopping video streaming service... [OK]',
        });
        newEntries.push({
          id: Date.now() + 2,
          type: 'success',
          text: 'CÁMARA DESACTIVADA. VÍA LIBRE. ENTRANDO AL EDIFICIO...',
        });
        setExteriorStep(7);
        setTerminalLogs((prev) => [...prev, ...newEntries]);

        if (transitionTimerRef.current) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          triggerScene6Transition();
        }, 1500);
        return;
      }

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: 'Command not recognized',
      });
      registerCommandFailure(newEntries);
      setTerminalLogs((prev) => [...prev, ...newEntries]);
      return;
    }

    // ========================================================================
    // ESCENA 6: LA CAJA FUERTE (HARDWARE HACKING - vaultStep)
    // ========================================================================
    if (sceneState === 'SCENE_6') {
      if (cmdLower === 'help') {
        if (vaultStep === 0) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'Comandos disponibles (Escena 6 - Caja Fuerte ECorp):',
              '  ping 127.0.0.1               Verifica conectividad ICMP local (+2% IDS)',
              '  nmap -sP / nmap -A / nmap -p- / nmap -v',
              '  minicom -D /dev/ttyUSB0',
              '  screen /dev/ttyUSB0 9600',
              '  logdump',
              '  clear',
            ].join('\n'),
          });
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: [
              'ECorp VaultOS v1.0 (vault>):',
              '  Introduce el código maestro de 7 dígitos obtenido al descifrar el Base64 en la Escena 4 (7355608).',
            ].join('\n'),
          });
        }
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      const serialConnectRegex =
        /^(?:minicom\s+(?:-[a-zA-Z0-9]+\s+)*-D\s+\/dev\/ttyUSB0(?:\s+-b\s+9600)?|screen\s+\/dev\/ttyUSB0(?:\s+9600)?)$/i;

      if (serialConnectRegex.test(trimmed)) {
        if (vaultStep >= 1) {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'Serial session already active on /dev/ttyUSB0.',
          });
          setTerminalLogs((prev) => [...prev, ...newEntries]);
          return;
        }

        updatePlayerScore(75, 'UART SERIAL LINK', 's6_serial');
        newEntries.push({
          id: Date.now() + 1,
          type: 'output',
          text: [
            'Opening serial connection to Vault Maintenance Port... [OK].',
            'ECorp VaultOS v1.0.',
            'ENTER OVERRIDE MASTER CODE:',
          ].join('\n'),
        });

        setVaultStep(1);
        setCurrentPrompt('vault>');
        setWindowTitle('elliot@fsociety:~/ecorp_vault (/dev/ttyUSB0)');
        setTerminalLogs((prev) => [...prev, ...newEntries]);
        return;
      }

      if (vaultStep === 1) {
        if (trimmed === '7355608') {
          updatePlayerScore(250, 'ECORP VAULT OPENED', 's6_vault_open');
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'CODE ACCEPTED. DISENGAGING LOCKS...',
          });
          newEntries.push({
            id: Date.now() + 2,
            type: 'success',
            text: '[!] VAULT OPENED [!]',
          });
          setVaultStep(2);
          setTerminalLogs((prev) => [...prev, ...newEntries]);

          if (transitionTimerRef.current) {
            window.clearTimeout(transitionTimerRef.current);
          }
          transitionTimerRef.current = window.setTimeout(() => {
            triggerWinScreen();
          }, 1200);
        } else {
          newEntries.push({
            id: Date.now() + 1,
            type: 'output',
            text: 'ACCESS DENIED. INVALID MASTER OVERRIDE CODE.\nENTER OVERRIDE MASTER CODE:',
          });
          registerCommandFailure(newEntries);
          setTerminalLogs((prev) => [...prev, ...newEntries]);
        }
        return;
      }

      newEntries.push({
        id: Date.now() + 1,
        type: 'output',
        text: 'Command not recognized',
      });
      registerCommandFailure(newEntries);
      setTerminalLogs((prev) => [...prev, ...newEntries]);
    }
  };

  // Navegar por el historial de comandos almacenado en el estado del componente (Flechas Arriba ↑ / Abajo ↓)
  const navigateCommandHistory = (direction: 'up' | 'down') => {
    if (commandHistory.length === 0 || isExecuting) return;

    const currentPointer =
      historyIndex < 0 || historyIndex > commandHistory.length
        ? commandHistory.length
        : historyIndex;

    if (direction === 'up') {
      // Si estamos en la línea nueva al final del historial, guardar el borrador actual antes de subir
      if (currentPointer === commandHistory.length) {
        setHistoryDraftInput(commandInput);
      }
      const nextIdx = Math.max(0, currentPointer - 1);
      const restoredCmd = commandHistory[nextIdx] ?? '';
      setHistoryIndex(nextIdx);
      setCommandInput(restoredCmd);
      window.requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(restoredCmd.length, restoredCmd.length);
        }
      });
    } else {
      if (currentPointer < commandHistory.length - 1) {
        const nextIdx = currentPointer + 1;
        const restoredCmd = commandHistory[nextIdx] ?? '';
        setHistoryIndex(nextIdx);
        setCommandInput(restoredCmd);
        window.requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(restoredCmd.length, restoredCmd.length);
          }
        });
      } else {
        setHistoryIndex(commandHistory.length);
        setCommandInput(historyDraftInput);
        window.requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(
              historyDraftInput.length,
              historyDraftInput.length
            );
          }
        });
      }
    }
  };

  // Handler de teclado en el input: SFX de tecleo, Atajos Ctrl+L / Ctrl+C, Historial, Tab Autocomplete y Enter
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Atajo real de consola 1: Ctrl + L para limpiar la pantalla en cualquier momento
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      playTypingSfx();
      setTerminalLogs([]);
      return;
    }

    // Atajo real de consola 2: Ctrl + C para abortar simulateExecution en curso o cancelar línea actual
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      if (isExecuting) {
        e.preventDefault();
        abortRunningExecution();
        return;
      }
      const selectedText = window.getSelection()?.toString() || '';
      if (!selectedText) {
        e.preventDefault();
        playErrorSfx();
        setTerminalLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: 'cmd',
            text: `${currentPrompt} ${commandInput}^C`,
          },
        ]);
        setCommandInput('');
        return;
      }
    }

    if (isExecuting) {
      e.preventDefault();
      return;
    }

    // Sonido 1 (Tecleo - 'Bip'): Se pasa la tecla pulsada a playTypingSfx(e.key)
    playTypingSfx(e.key);

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateCommandHistory('up');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateCommandHistory('down');
      return;
    }

    // Autocompletado con Tab (Comandos de red como nmap, ping, sqlmap, etc. + Archivos del directorio virtual de la escena actual)
    if (e.key === 'Tab') {
      e.preventDefault();
      triggerTabAutocomplete();
      return;
    }

    if (e.key === 'Enter') {
      processCommand(commandInput);
      setCommandInput('');
    }
  };

  // Obtener la lista de archivos y subdirectorios presentes en el directorio virtual (VFS) de la escena y sesión actual
  const getCurrentSceneVfsFiles = (): string[] => {
    if (vfsSubdir === '.ssh') {
      return ['known_hosts', '..'];
    }
    if (sceneState === 'SCENE_2' && internalStep === 2) {
      return ['config_backup.bak', 'angela_moss_resume.pdf', '.printer_debug.log'];
    }
    if (sceneState === 'SCENE_3' && (securityStep === 2 || securityStep === 3)) {
      return ['access_records.csv', '.smb_audit.log'];
    }

    switch (sceneState) {
      case 'SCENE_1':
        return [
          'targets.txt',
          'readme_darlene.txt',
          '.bash_history',
          '.mr_robot_note.txt',
          '.ssh',
          '.ssh/known_hosts',
        ];
      case 'SCENE_2':
        return [
          'subnet_notes.txt',
          'config_backup.bak',
          'angela_moss_resume.pdf',
          '.bash_history',
          '.lloyd_notes.txt',
          '.printer_debug.log',
          '.ssh',
          '.ssh/known_hosts',
        ];
      case 'SCENE_3':
        return [
          'rfid_manual.txt',
          'access_records.csv',
          '.bash_history',
          '.gideon_audit.txt',
          '.smb_audit.log',
          '.ssh',
          '.ssh/known_hosts',
        ];
      case 'SCENE_4':
        if (ceoStep >= 2) {
          return [
            'safe_code.b64',
            'project_washington.txt',
            'fsociety00.dat',
            '.bash_history',
            '.tyrell_diary.txt',
            '.ssh',
            '.ssh/known_hosts',
          ];
        }
        return [
          'rockyou.txt',
          'target_ceo.txt',
          'safe_code.b64',
          'project_washington.txt',
          'fsociety00.dat',
          '.bash_history',
          '.tyrell_profile.txt',
          '.ssh',
          '.ssh/known_hosts',
        ];
      case 'SCENE_5':
        if (exteriorStep >= 6) {
          return [
            'streamd.conf',
            'loop_stream.sh',
            'pasillo_vacio.mp4',
            '.bash_history',
            '.firmware_notes.txt',
            '.ssh',
            '.ssh/known_hosts',
          ];
        }
        return [
          'evil_portal.py',
          'wifi_targets.txt',
          'streamd.conf',
          'loop_stream.sh',
          '.bash_history',
          '.guard_shift.log',
          '.cam_defaults.txt',
          '.ssh',
          '.ssh/known_hosts',
        ];
      case 'SCENE_6':
      default:
        return [
          'vault_manual.txt',
          '/dev/ttyUSB0',
          '.bash_history',
          '.vault_pinout.txt',
          '.ssh',
          '.ssh/known_hosts',
        ];
    }
  };

  // Calcular el prefijo común más largo (Longest Common Prefix) entre múltiples candidatos de autocompletado
  const computeLongestCommonPrefix = (candidates: string[]): string => {
    if (candidates.length === 0) return '';
    let prefix = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const item = candidates[i];
      let j = 0;
      while (
        j < prefix.length &&
        j < item.length &&
        prefix[j].toLowerCase() === item[j].toLowerCase()
      ) {
        j++;
      }
      prefix = prefix.slice(0, j);
      if (!prefix) break;
    }
    return prefix;
  };

  // Ejecutar autocompletado con la tecla Tab (o botón [TAB]) para comandos de red y archivos del directorio virtual actual
  const triggerTabAutocomplete = () => {
    const rawVal = commandInput;
    const trimmedVal = rawVal.trim();
    const currentSceneFiles = getCurrentSceneVfsFiles();

    const baseCommands = [
      'nmap',
      'ping',
      'sqlmap',
      'smbclient',
      'proxmark3',
      'minicom',
      'ftp',
      'hydra',
      'ssh',
      'python3',
      'curl',
      'telnet',
      'screen',
      'aireplay-ng',
      'base64',
      'service',
      'killall',
      'macchanger',
      'proxychains',
      'shred',
      'rm',
      'tcpdump',
      'get',
      'cat',
      'ls',
      'pwd',
      'cd',
      'echo',
      'logdump',
      'top',
      'htop',
      'kill',
      'theme',
      'history',
      'hint',
      'help',
      'clear',
      'whoami',
      'fsociety',
      'unlock_god',
      'god_mode',
      'riddle',
      'debug_auth',
      'reset_ctf',
      'exit',
    ];

    // Si el input está vacío al pulsar Tab, mostrar resumen rápido de comandos de red y archivos del directorio actual
    if (!trimmedVal) {
      const visibleOnly = currentSceneFiles.filter((f) => !f.startsWith('.') || f === '.ssh');
      setTerminalLogs((prev) => [
        ...prev,
        {
          id: Date.now(),
          type: 'output',
          text: [
            `[AUTOCOMPLETADO TAB — ${sceneState}]`,
            `  Comandos de red : nmap   ping   sqlmap   ftp   smbclient   ssh   hydra   curl   telnet   minicom   tcpdump   macchanger   theme`,
            `  Archivos (${vfsSubdir ? `~/${vfsSubdir}` : '~'}) : ${
              visibleOnly.join('   ') || '(ninguno)'
            }   (usa "." + Tab para ocultos)`,
          ].join('\n'),
        },
      ]);
      return;
    }

    const lowerTrimmed = trimmedVal.toLowerCase();

    // 1. Expansión directa de plantillas de comandos de red y seguridad cuando el usuario pulsa Tab sobre el comando base
    if (lowerTrimmed === 'theme' || lowerTrimmed.startsWith('theme ')) {
      const partialTheme = lowerTrimmed.replace(/^theme\s*/, '');
      const themeOptions = ['matrix', 'dracula', 'monokai'];
      const matches = themeOptions.filter((t) => t.startsWith(partialTheme));
      if (matches.length === 1) {
        setCommandInput(`theme ${matches[0]}`);
      } else {
        const nextTheme =
          terminalTheme === 'matrix'
            ? 'dracula'
            : terminalTheme === 'dracula'
              ? 'monokai'
              : 'matrix';
        setCommandInput(`theme ${nextTheme}`);
      }
      return;
    }
    if (lowerTrimmed === 'macchanger' || lowerTrimmed === 'macchanger -r') {
      setCommandInput('macchanger -r wlan0mon');
      return;
    }
    if (lowerTrimmed === 'unlock_god' || lowerTrimmed === 'riddle') {
      setCommandInput('unlock_god root');
      return;
    }
    if (lowerTrimmed === 'god' || lowerTrimmed === 'god_') {
      setCommandInput('god_mode');
      return;
    }
    if (lowerTrimmed === 'shred' || lowerTrimmed === 'shred -u') {
      setCommandInput('shred -u /var/log/auth.log');
      return;
    }
    if (lowerTrimmed === 'rm' || lowerTrimmed === 'rm -rf') {
      setCommandInput('rm -rf /var/log/*');
      return;
    }
    if (lowerTrimmed === 'tcpdump') {
      setCommandInput('tcpdump -i wlan0mon -X');
      return;
    }
    if (lowerTrimmed === 'history' || lowerTrimmed === 'history -') {
      setCommandInput('history -c');
      return;
    }
    if (lowerTrimmed === 'kill' || lowerTrimmed === 'kill -' || lowerTrimmed === 'kill -9') {
      setCommandInput('kill -9 1337');
      return;
    }
    if (lowerTrimmed === 'ping') {
      const defaultPingTarget =
        sceneState === 'SCENE_1'
          ? 'ping ecorp.com'
          : sceneState === 'SCENE_2'
          ? 'ping 10.0.0.15'
          : sceneState === 'SCENE_3'
          ? 'ping 10.0.0.50'
          : sceneState === 'SCENE_4'
          ? 'ping 10.0.0.100'
          : sceneState === 'SCENE_5'
          ? 'ping 192.168.99.20'
          : 'ping 127.0.0.1';
      setCommandInput(defaultPingTarget);
      return;
    }
    if (lowerTrimmed === 'nmap') {
      const defaultNmapTarget =
        sceneState === 'SCENE_1'
          ? 'nmap ecorp.com'
          : sceneState === 'SCENE_2'
          ? 'nmap 10.0.0.0/24'
          : sceneState === 'SCENE_3'
          ? 'nmap -p- 10.0.0.50'
          : sceneState === 'SCENE_4'
          ? 'nmap -v 10.0.0.100'
          : sceneState === 'SCENE_5'
          ? 'nmap 192.168.99.0/24'
          : 'nmap -p- 127.0.0.1';
      setCommandInput(defaultNmapTarget);
      return;
    }
    if (
      lowerTrimmed === 'nmap -s' ||
      lowerTrimmed === 'nmap -sp' ||
      lowerTrimmed === 'nmap -sn'
    ) {
      const pingTarget =
        sceneState === 'SCENE_1'
          ? 'nmap -sP 198.51.100.0/24'
          : sceneState === 'SCENE_2'
          ? 'nmap -sP 10.0.0.0/24'
          : sceneState === 'SCENE_3'
          ? 'nmap -sP 10.0.0.0/24'
          : sceneState === 'SCENE_4'
          ? 'nmap -sP 10.0.0.0/24'
          : sceneState === 'SCENE_5'
          ? 'nmap -sP 192.168.99.0/24'
          : 'nmap -sP 127.0.0.1';
      setCommandInput(pingTarget);
      return;
    }
    if (lowerTrimmed === 'nmap -a' || lowerTrimmed === 'nmap -o') {
      const aggressiveTarget =
        sceneState === 'SCENE_1'
          ? 'nmap -A ecorp.com'
          : sceneState === 'SCENE_2'
          ? 'nmap -A 10.0.0.15'
          : sceneState === 'SCENE_3'
          ? 'nmap -A 10.0.0.50'
          : sceneState === 'SCENE_4'
          ? 'nmap -A 10.0.0.100'
          : sceneState === 'SCENE_5'
          ? 'nmap -A 192.168.99.20'
          : 'nmap -A 127.0.0.1';
      setCommandInput(aggressiveTarget);
      return;
    }
    if (lowerTrimmed === 'nmap -p' || lowerTrimmed === 'nmap -p-') {
      const deepTarget =
        sceneState === 'SCENE_1'
          ? 'nmap -p- ecorp.com'
          : sceneState === 'SCENE_2'
          ? 'nmap -p- 10.0.0.0/24'
          : sceneState === 'SCENE_3'
          ? 'nmap -p- 10.0.0.50'
          : sceneState === 'SCENE_4'
          ? 'nmap -p- 10.0.0.100'
          : sceneState === 'SCENE_5'
          ? 'nmap -p- 192.168.99.0/24'
          : 'nmap -p- 127.0.0.1';
      setCommandInput(deepTarget);
      return;
    }
    if (lowerTrimmed === 'nmap -v') {
      const verboseTarget =
        sceneState === 'SCENE_1'
          ? 'nmap -v ecorp.com'
          : sceneState === 'SCENE_2'
          ? 'nmap -v 10.0.0.0/24'
          : sceneState === 'SCENE_3'
          ? 'nmap -v 10.0.0.50'
          : sceneState === 'SCENE_4'
          ? 'nmap -v 10.0.0.100'
          : sceneState === 'SCENE_5'
          ? 'nmap -v 192.168.99.0/24'
          : 'nmap -v 127.0.0.1';
      setCommandInput(verboseTarget);
      return;
    }
    if (lowerTrimmed === 'sqlmap -d' || lowerTrimmed === 'sqlmap --d' || lowerTrimmed === 'sqlmap -dump') {
      setCommandInput('sqlmap -dump');
      return;
    }
    if (lowerTrimmed === 'sqlmap' || lowerTrimmed === 'sqlmap -u') {
      setCommandInput('sqlmap -u "http://ecorp.com/login.php?id=1" --dbs');
      return;
    }
    if (lowerTrimmed === 'smbclient') {
      setCommandInput(
        securityStep === 0
          ? 'smbclient -L //10.0.0.50 -U print-admin%P@ssw0rd_pr1nt'
          : 'smbclient //10.0.0.50/Security_Logs -U print-admin%P@ssw0rd_pr1nt'
      );
      return;
    }
    if (lowerTrimmed === 'proxmark3' || lowerTrimmed === 'proxmark3 -c') {
      setCommandInput('proxmark3 -c "hf mf cload -f 047AB219C855"');
      return;
    }
    if (lowerTrimmed === 'minicom' || lowerTrimmed === 'minicom -d') {
      setCommandInput('minicom -D /dev/ttyUSB0');
      return;
    }
    if (lowerTrimmed === 'hydra') {
      setCommandInput('hydra -l ceo -P rockyou.txt ssh://10.0.0.100');
      return;
    }
    if (lowerTrimmed === 'ssh') {
      setCommandInput('ssh ceo@10.0.0.100');
      return;
    }
    if (lowerTrimmed === 'python3') {
      setCommandInput('python3 evil_portal.py --ssid "ECorp_Security"');
      return;
    }
    if (lowerTrimmed === 'aireplay-ng') {
      setCommandInput('aireplay-ng --deauth 0 -a 00:14:22:01:23:45 wlan0mon');
      return;
    }
    if (lowerTrimmed === 'base64' || lowerTrimmed === 'base64 -d') {
      setCommandInput('base64 -d safe_code.b64');
      return;
    }
    if (lowerTrimmed === 'curl') {
      setCommandInput(
        'curl -u guard_01:Al4rm_0ff_99 -X POST http://192.168.99.10/api/alarm/disable'
      );
      return;
    }
    if (lowerTrimmed === 'ftp') {
      setCommandInput('ftp 10.0.0.15');
      return;
    }
    if (lowerTrimmed === 'telnet') {
      setCommandInput('telnet 192.168.99.20');
      return;
    }
    if (lowerTrimmed === 'screen') {
      setCommandInput('screen /dev/ttyUSB0 9600');
      return;
    }

    const hasTrailingSpace = /\s$/.test(rawVal);
    const nonEmptyTokens = trimmedVal.split(/\s+/);
    const firstCmd = nonEmptyTokens[0].toLowerCase();

    // 2. Si el usuario ha escrito un comando de archivos seguido de espacio (ej: "cat ", "get ", "cd ", "ls ")
    if (hasTrailingSpace && nonEmptyTokens.length === 1) {
      if (firstCmd === 'get') {
        if (sceneState === 'SCENE_2') {
          setCommandInput('get config_backup.bak');
          return;
        }
        if (sceneState === 'SCENE_3') {
          setCommandInput('get access_records.csv');
          return;
        }
      }
      if (firstCmd === 'cd') {
        setCommandInput(vfsSubdir === '.ssh' ? 'cd ..' : 'cd .ssh');
        return;
      }
      if (firstCmd === 'cat' || firstCmd === 'ls') {
        const visibleSceneFiles = currentSceneFiles.filter((f) => !f.startsWith('.'));
        if (visibleSceneFiles.length === 1) {
          setCommandInput(`${firstCmd} ${visibleSceneFiles[0]}`);
        } else {
          setTerminalLogs((prev) => [
            ...prev,
            {
              id: Date.now(),
              type: 'output',
              text: currentSceneFiles.join('   '),
            },
          ]);
        }
        return;
      }
    }

    // 3. Si el usuario está escribiendo un segundo o posterior argumento (archivos del directorio virtual actual o hosts/IPs de red)
    if (nonEmptyTokens.length >= 2 || (hasTrailingSpace && nonEmptyTokens.length >= 1)) {
      const lastToken = hasTrailingSpace ? '' : nonEmptyTokens[nonEmptyTokens.length - 1];
      const hasDotSlash = lastToken.startsWith('./');
      const cleanLastToken = hasDotSlash ? lastToken.slice(2) : lastToken;
      const lowerLast = cleanLastToken.toLowerCase();
      const prefixBeforeLast = rawVal.slice(0, rawVal.length - lastToken.length);

      const isNetworkCmd = [
        'nmap',
        'ping',
        'ftp',
        'ssh',
        'telnet',
        'smbclient',
        'hydra',
        'sqlmap',
        'curl',
      ].includes(firstCmd);

      const networkTargetsByScene: Record<string, string[]> = {
        SCENE_1: [
          'ecorp.com',
          '198.51.100.42',
          '198.51.100.0/24',
          '198.51.100.1',
          '198.51.100.10',
          'http://ecorp.com/login.php?id=1',
          '-dump',
          '--dump',
          '--dbs',
          '-sP',
          '-A',
          '-p-',
          '-v',
        ],
        SCENE_2: [
          '10.0.0.0/24',
          '10.0.0.15',
          '10.0.0.10',
          '10.0.0.1',
          '10.0.0.50',
          '-sP',
          '-A',
          '-p-',
          '-v',
        ],
        SCENE_3: [
          '10.0.0.50',
          '10.0.0.0/24',
          '//10.0.0.50/Security_Logs',
          '//10.0.0.50',
          '-sP',
          '-A',
          '-p-',
          '-v',
        ],
        SCENE_4: [
          '10.0.0.100',
          'ceo@10.0.0.100',
          'ssh://10.0.0.100',
          '10.0.0.0/24',
          '-sP',
          '-A',
          '-p-',
          '-v',
        ],
        SCENE_5: [
          '192.168.99.20',
          '192.168.99.10',
          '192.168.99.0/24',
          '192.168.99.1',
          '-sP',
          '-A',
          '-p-',
          '-v',
        ],
        SCENE_6: ['127.0.0.1', 'localhost', '/dev/ttyUSB0', '-sP', '-A', '-p-', '-v'],
      };

      const candidatePool = isNetworkCmd
        ? Array.from(
            new Set([
              ...(networkTargetsByScene[sceneState] || []),
              'ecorp.com',
              '10.0.0.15',
              '10.0.0.50',
              '10.0.0.100',
              '192.168.99.20',
              '127.0.0.1',
              ...currentSceneFiles,
            ])
          )
        : currentSceneFiles;

      const matchingCandidates = candidatePool.filter((item) =>
        item.toLowerCase().startsWith(lowerLast)
      );

      if (matchingCandidates.length === 1) {
        const completed = hasDotSlash ? `./${matchingCandidates[0]}` : matchingCandidates[0];
        setCommandInput(`${prefixBeforeLast}${completed}`);
        return;
      } else if (matchingCandidates.length > 1) {
        const lcp = computeLongestCommonPrefix(matchingCandidates);
        if (lcp.length > cleanLastToken.length) {
          const completedLcp = hasDotSlash ? `./${lcp}` : lcp;
          setCommandInput(`${prefixBeforeLast}${completedLcp}`);
        }
        setTerminalLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: 'output',
            text: matchingCandidates.join('   '),
          },
        ]);
        return;
      }
    }

    // 4. Autocompletado del primer token (comandos de red y de terminal)
    if (nonEmptyTokens.length === 1 && !hasTrailingSpace) {
      const matchingCmds = baseCommands.filter((cmd) => cmd.startsWith(lowerTrimmed));
      if (matchingCmds.length === 1) {
        const matched = matchingCmds[0];
        const needsSpace = [
          'nmap',
          'ping',
          'sqlmap',
          'smbclient',
          'proxmark3',
          'minicom',
          'ftp',
          'hydra',
          'ssh',
          'python3',
          'curl',
          'telnet',
          'screen',
          'aireplay-ng',
          'base64',
          'get',
          'cat',
          'cd',
          'kill',
          'debug_auth',
        ].includes(matched);
        setCommandInput(needsSpace ? `${matched} ` : matched);
        return;
      } else if (matchingCmds.length > 1) {
        const lcp = computeLongestCommonPrefix(matchingCmds);
        if (lcp.length > lowerTrimmed.length) {
          setCommandInput(lcp);
        }
        setTerminalLogs((prev) => [
          ...prev,
          {
            id: Date.now(),
            type: 'output',
            text: matchingCmds.join('   '),
          },
        ]);
        return;
      }
    }
  };

  const containerBgClass =
    sceneState === 'SCENE_6' || sceneState === 'WIN'
      ? useBackgroundImg
        ? 'scene-6-bg'
        : 'scene-0-solid'
      : sceneState === 'SCENE_5'
      ? useBackgroundImg
        ? 'scene-5-bg'
        : 'scene-0-solid'
      : sceneState === 'SCENE_4'
      ? useBackgroundImg
        ? 'scene-4-bg'
        : 'scene-0-solid'
      : sceneState === 'SCENE_3'
      ? useBackgroundImg
        ? 'scene-3-bg'
        : 'scene-0-solid'
      : sceneState === 'SCENE_2'
      ? useBackgroundImg
        ? 'scene-2-bg'
        : 'scene-0-solid'
      : sceneState === 'SCENE_1'
      ? useBackgroundImg
        ? 'scene-1-bg'
        : 'scene-0-solid'
      : useBackgroundImg
      ? 'scene-0-bg'
      : 'scene-0-solid';

  const currentBgLabel = !useBackgroundImg
    ? 'Fondo: #1a1a1a'
    : sceneState === 'SCENE_6' || sceneState === 'WIN'
    ? 'Fondo: scene6_vault.jpg'
    : sceneState === 'SCENE_5'
    ? 'Fondo: scene5_exterior.jpg'
    : sceneState === 'SCENE_4'
    ? 'Fondo: scene4_ceo.jpg'
    : sceneState === 'SCENE_3'
    ? 'Fondo: scene3_security.jpg'
    : sceneState === 'SCENE_2'
    ? 'Fondo: scene2_internal.jpg'
    : sceneState === 'SCENE_1'
    ? 'Fondo: scene1_sqli.jpg'
    : 'Fondo: scene0_welcome.jpg';

  const isPasswordInput =
    (sceneState === 'SCENE_4' && ceoStep === 1.5) ||
    (sceneState === 'SCENE_5' && exteriorStep === 5);

  // ==========================================================================
  // ESTADO DINÁMICO DE LOS 5 NODOS DE NETWORK TOPOLOGY (#network-map)
  // ==========================================================================
  const isWebCompromised =
    sceneState === 'SCENE_2' ||
    sceneState === 'SCENE_3' ||
    sceneState === 'SCENE_4' ||
    sceneState === 'SCENE_5' ||
    sceneState === 'SCENE_6' ||
    sceneState === 'WIN';

  const isPrinterCompromised =
    (sceneState === 'SCENE_2' && internalStep >= 3) ||
    sceneState === 'SCENE_3' ||
    sceneState === 'SCENE_4' ||
    sceneState === 'SCENE_5' ||
    sceneState === 'SCENE_6' ||
    sceneState === 'WIN';

  const isSecurityCompromised =
    (sceneState === 'SCENE_3' && securityStep >= 5) ||
    sceneState === 'SCENE_4' ||
    sceneState === 'SCENE_5' ||
    sceneState === 'SCENE_6' ||
    sceneState === 'WIN';

  const isCeoCompromised =
    (sceneState === 'SCENE_4' && ceoStep >= 3) ||
    sceneState === 'SCENE_5' ||
    sceneState === 'SCENE_6' ||
    sceneState === 'WIN';

  const isVaultCompromised =
    (sceneState === 'SCENE_6' && vaultStep >= 2) || sceneState === 'WIN';

  const compromisedCount = [
    isWebCompromised,
    isPrinterCompromised,
    isSecurityCompromised,
    isCeoCompromised,
    isVaultCompromised,
  ].filter(Boolean).length;

  const activeTargetNodeId =
    sceneState === 'SCENE_1'
      ? 'node-web'
      : sceneState === 'SCENE_2'
        ? 'node-printer'
        : sceneState === 'SCENE_3'
          ? 'node-security'
          : sceneState === 'SCENE_4'
            ? 'node-ceo'
            : sceneState === 'SCENE_5' || sceneState === 'SCENE_6'
              ? 'node-vault'
              : 'node-web';

  // Sincronizar nodo seleccionado automáticamente al cambiar de escena
  useEffect(() => {
    setSelectedTopologyNodeId(activeTargetNodeId);
  }, [activeTargetNodeId]);

  // ==========================================================================
  // GRAFO INTERACTIVO D3.JS DE TOPOLOGÍA DE RED (#network-map -> #d3-topology-svg)
  // ==========================================================================
  useEffect(() => {
    if (!isNetworkMapOpen || isNetworkMapMinimized || !d3TopologySvgRef.current) {
      return;
    }

    interface D3TopologyNode extends d3.SimulationNodeDatum {
      id: string;
      code: string;
      label: string;
      ip: string;
      role: string;
      compromised: boolean;
      activeTarget: boolean;
      targetX: number;
      targetY: number;
    }

    interface D3TopologyLink extends d3.SimulationLinkDatum<D3TopologyNode> {
      id: string;
      source: string | D3TopologyNode;
      target: string | D3TopologyNode;
      compromised: boolean;
      activeRoute: boolean;
      isMesh?: boolean;
    }

    const width = 360;
    const height = 176;

    const nodesData: D3TopologyNode[] = [
      {
        id: 'node-web',
        code: '01',
        label: 'Web DMZ',
        ip: '198.51.100.42',
        role: 'Apache / SQLi Gateway',
        compromised: isWebCompromised,
        activeTarget: sceneState === 'SCENE_1',
        targetX: 44,
        targetY: 54,
        x: 44,
        y: 54,
      },
      {
        id: 'node-printer',
        code: '02',
        label: 'Impresora',
        ip: '10.0.0.15',
        role: 'HP LaserJet / Pivot',
        compromised: isPrinterCompromised,
        activeTarget: sceneState === 'SCENE_2',
        targetX: 114,
        targetY: 122,
        x: 114,
        y: 122,
      },
      {
        id: 'node-security',
        code: '03',
        label: 'Seguridad',
        ip: '10.0.0.50',
        role: 'Control de accesos RFID',
        compromised: isSecurityCompromised,
        activeTarget: sceneState === 'SCENE_3',
        targetX: 182,
        targetY: 50,
        x: 182,
        y: 50,
      },
      {
        id: 'node-ceo',
        code: '04',
        label: 'CEO',
        ip: '10.0.0.100',
        role: 'Estación del CEO',
        compromised: isCeoCompromised,
        activeTarget: sceneState === 'SCENE_4',
        targetX: 252,
        targetY: 122,
        x: 252,
        y: 122,
      },
      {
        id: 'node-vault',
        code: '05',
        label: 'Bóveda',
        ip: '192.168.99.x',
        role: 'Perímetro y cámara acorazada',
        compromised: isVaultCompromised,
        activeTarget: sceneState === 'SCENE_5' || sceneState === 'SCENE_6',
        targetX: 316,
        targetY: 64,
        x: 316,
        y: 64,
      },
    ];

    const linksData: D3TopologyLink[] = [
      {
        id: 'link-web-printer',
        source: 'node-web',
        target: 'node-printer',
        compromised: isWebCompromised && isPrinterCompromised,
        activeRoute: isWebCompromised && !isPrinterCompromised,
      },
      {
        id: 'link-printer-security',
        source: 'node-printer',
        target: 'node-security',
        compromised: isPrinterCompromised && isSecurityCompromised,
        activeRoute: isPrinterCompromised && !isSecurityCompromised,
      },
      {
        id: 'link-security-ceo',
        source: 'node-security',
        target: 'node-ceo',
        compromised: isSecurityCompromised && isCeoCompromised,
        activeRoute: isSecurityCompromised && !isCeoCompromised,
      },
      {
        id: 'link-ceo-vault',
        source: 'node-ceo',
        target: 'node-vault',
        compromised: isCeoCompromised && isVaultCompromised,
        activeRoute: isCeoCompromised && !isVaultCompromised,
      },
      // Enlaces secundarios de topología interna (malla ECorp)
      {
        id: 'link-web-security',
        source: 'node-web',
        target: 'node-security',
        compromised: isWebCompromised && isSecurityCompromised,
        activeRoute: false,
        isMesh: true,
      },
      {
        id: 'link-security-vault',
        source: 'node-security',
        target: 'node-vault',
        compromised: isSecurityCompromised && isVaultCompromised,
        activeRoute: false,
        isMesh: true,
      },
    ];

    const svg = d3.select(d3TopologySvgRef.current);
    svg.selectAll('*').remove();

    // Definición de filtros glow y marcadores direccionales
    const defs = svg.append('defs');

    const greenGlow = defs
      .append('filter')
      .attr('id', 'd3-green-glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    greenGlow
      .append('feGaussianBlur')
      .attr('stdDeviation', '3.2')
      .attr('result', 'coloredBlur');
    const feMerge = greenGlow.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Capa de enlaces (aristas de red)
    const linkLayer = svg.append('g').attr('class', 'd3-links-layer');
    const linkElements = linkLayer
      .selectAll<SVGLineElement, D3TopologyLink>('line')
      .data(linksData, (d) => d.id)
      .enter()
      .append('line')
      .attr('class', (d) =>
        [
          'd3-link',
          d.compromised ? 'compromised' : '',
          d.activeRoute ? 'active-route' : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
      .style('stroke-opacity', (d) => (d.isMesh && !d.compromised ? 0.35 : 0.92));

    // Capa de nodos interactivos
    const nodeLayer = svg.append('g').attr('class', 'd3-nodes-layer');
    const nodeGroups = nodeLayer
      .selectAll<SVGGElement, D3TopologyNode>('g.d3-node-group')
      .data(nodesData, (d) => d.id)
      .enter()
      .append('g')
      .attr('id', (d) => `d3-${d.id}`)
      .attr('class', (d) =>
        [
          'd3-node-group',
          d.compromised ? 'compromised' : 'locked',
          d.activeTarget ? 'active-target' : '',
          selectedTopologyNodeId === d.id ? 'selected-node' : '',
        ]
          .filter(Boolean)
          .join(' ')
      )
      .on('click', (_event, d) => {
        setSelectedTopologyNodeId(d.id);
      });

    // Halo exterior pulsante (parpadea en verde cuando el nodo es comprometido)
    nodeGroups
      .append('circle')
      .attr('class', 'd3-node-halo')
      .attr('r', (d) => (d.compromised ? 22 : 19));

    // Núcleo del nodo (parpadea en verde #00ff00 cuando es comprometido)
    nodeGroups
      .append('circle')
      .attr('class', 'd3-node-core')
      .attr('r', 14)
      .attr('filter', (d) => (d.compromised ? 'url(#d3-green-glow)' : null));

    // Código numérico interior (01..05)
    nodeGroups
      .append('text')
      .attr('class', 'd3-node-code')
      .attr('dy', '0.1em')
      .text((d) => d.code);

    // Etiqueta del nombre del nodo
    nodeGroups
      .append('text')
      .attr('class', 'd3-node-caption')
      .attr('y', 25)
      .text((d) => d.label);

    // Etiqueta de IP del nodo
    nodeGroups
      .append('text')
      .attr('class', 'd3-node-ip-tag')
      .attr('y', 34)
      .text((d) => d.ip);

    // Simulación de fuerzas D3.js con arrastre interactivo
    const simulation = d3
      .forceSimulation<D3TopologyNode>(nodesData)
      .force(
        'link',
        d3
          .forceLink<D3TopologyNode, D3TopologyLink>(linksData)
          .id((d) => d.id)
          .distance((d) => (d.isMesh ? 130 : 76))
          .strength((d) => (d.isMesh ? 0.15 : 0.45))
      )
      .force('charge', d3.forceManyBody().strength(-65))
      .force('x', d3.forceX<D3TopologyNode>((d) => d.targetX).strength(0.65))
      .force('y', d3.forceY<D3TopologyNode>((d) => d.targetY).strength(0.65))
      .force('collide', d3.forceCollide(28))
      .alphaDecay(0.05);

    const dragBehavior = d3
      .drag<SVGGElement, D3TopologyNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.35).restart();
        d.fx = d.x;
        d.fy = d.y;
        setSelectedTopologyNodeId(d.id);
      })
      .on('drag', (event, d) => {
        d.fx = Math.max(26, Math.min(width - 26, event.x));
        d.fy = Math.max(24, Math.min(height - 38, event.y));
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGroups.call(dragBehavior);

    simulation.on('tick', () => {
      nodesData.forEach((d) => {
        d.x = Math.max(26, Math.min(width - 26, d.x ?? d.targetX));
        d.y = Math.max(24, Math.min(height - 38, d.y ?? d.targetY));
      });

      linkElements
        .attr('x1', (d) => (d.source as D3TopologyNode).x ?? 0)
        .attr('y1', (d) => (d.source as D3TopologyNode).y ?? 0)
        .attr('x2', (d) => (d.target as D3TopologyNode).x ?? 0)
        .attr('y2', (d) => (d.target as D3TopologyNode).y ?? 0);

      nodeGroups.attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [
    isNetworkMapOpen,
    isNetworkMapMinimized,
    isWebCompromised,
    isPrinterCompromised,
    isSecurityCompromised,
    isCeoCompromised,
    isVaultCompromised,
    sceneState,
    selectedTopologyNodeId,
  ]);

  const topologyInspectorMeta: Record<
    string,
    { code: string; name: string; ip: string; service: string; owned: boolean }
  > = {
    'node-web': {
      code: '01',
      name: 'Web DMZ',
      ip: '198.51.100.42',
      service: 'HTTP 80 · MySQL 3306',
      owned: isWebCompromised,
    },
    'node-printer': {
      code: '02',
      name: 'Impresora',
      ip: '10.0.0.15',
      service: 'FTP 21 · SMB 445',
      owned: isPrinterCompromised,
    },
    'node-security': {
      code: '03',
      name: 'Seguridad',
      ip: '10.0.0.50',
      service: 'SMB 445 · RFID',
      owned: isSecurityCompromised,
    },
    'node-ceo': {
      code: '04',
      name: 'Despacho del CEO',
      ip: '10.0.0.100',
      service: 'SSH 22',
      owned: isCeoCompromised,
    },
    'node-vault': {
      code: '05',
      name: 'Caja Fuerte',
      ip: '192.168.99.0/24',
      service: 'Wi-Fi · Telnet 23 · UART',
      owned: isVaultCompromised,
    },
  };
  const inspectedNode =
    topologyInspectorMeta[selectedTopologyNodeId] ?? topologyInspectorMeta['node-web'];

  const monologueNode = activeMonologue ? (
        <aside
          id="elliot-monologue"
          className={activeMonologue.isParanoia ? 'paranoia-tone' : ''}
          role="status"
          aria-live="polite"
        >
          <div className="monologue-header">
            <span className="monologue-speaker-badge">
              <span className="monologue-voice-wave" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>{activeMonologue.contextLabel}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextVal = !isVoiceMonologueEnabled;
                  setIsVoiceMonologueEnabled(nextVal);
                  if (!nextVal && typeof window !== 'undefined' && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                }}
                className="text-[10px] font-mono text-neutral-300 hover:text-[#00ff41] cursor-pointer"
                title="Activar/Desactivar síntesis de voz en el monólogo interior de Elliot"
              >
                [VOZ: {isVoiceMonologueEnabled ? 'ON' : 'OFF'}]
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                  setActiveMonologue(null);
                }}
                className="text-[10px] font-mono text-neutral-400 hover:text-white cursor-pointer"
                title="Ocultar subtítulo"
              >
                [×]
              </button>
            </div>
          </div>

          <p className="monologue-text">{activeMonologue.text}</p>
        </aside>
  ) : null;

  return (
    <main id="game-container" className={containerBgClass}>
      {/* Música de fondo inmersiva */}
      <audio
        id="bg-music"
        ref={bgMusicRef}
        src={`${ASSET_BASE}assets/audio/ost_fsociety.mp3`}
        muted={isMuted}
        loop
      />

      {/* Trama Manga Seinen + Viñeta */}
      <div className="manga-overlay" />
      <div className="manga-vignette" />

      {/* Barra superior: marca, marcador de la partida y controles */}
      <header id="fs-topbar" ref={topbarRef} className={isGameActive ? 'in-game' : ''}>
        <a
          className="fs-brand"
          href={HOUSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Un Fantasma en el Sistema"
        >
          <img src={HOUSE_LOGO_PATH} alt="Un Fantasma en el Sistema" width={30} height={30} />
          <span className="fs-brand-text">
            <strong>FSOCIETY CTF</strong>
            <small>Operación 5/9</small>
          </span>
        </a>

      {/* Temporizador de Speedrun + Puntuación en Pantalla (Score) + Nivel de Alerta IDS Allsafe (Esquina superior izquierda) */}
      {isGameActive && (
        <div id="uptime-hud" role="timer" aria-live="off">
          <div className="hud-top-row">
            <span id="uptime-display">{formatUptime(elapsedSeconds)}</span>
            <div className="hud-score-group">
              <span
                id="score-display"
                title="Puntuación en pantalla: suma puntos con cada acción de hacking exitosa y resta por cada error detectado"
              >
                SCORE: {playerScore} PTS
              </span>
              {scoreDeltaToast && (
                <span
                  key={scoreDeltaToast.id}
                  id="score-delta-badge"
                  className={`score-delta-pill ${
                    scoreDeltaToast.delta >= 0 ? 'positive' : 'negative'
                  }`}
                >
                  {scoreDeltaToast.delta >= 0
                    ? `+${scoreDeltaToast.delta}`
                    : scoreDeltaToast.delta}{' '}
                  PTS [{scoreDeltaToast.reason}]
                </span>
              )}
            </div>
            <span
              className={`hud-forensic-badge ${logsCleared ? 'ghost' : 'exposed'}`}
              title={
                logsCleared
                  ? 'Registros /var/log eliminados con shred/rm -rf (Rango Ghost Operator asegurado)'
                  : "Rastro forense activo. Ejecuta 'shred -u /var/log/auth.log' o 'rm -rf /var/log/*' para borrar huellas."
              }
            >
              {logsCleared ? '0% HUELLA [GHOST]' : 'HUELLA: ACTIVA'}
            </span>
            <span
              id="hud-difficulty-badge"
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold border ${
                difficulty === 'EASY'
                  ? 'border-[#00ff41]/70 text-[#00ff41] bg-[#00ff41]/10'
                  : difficulty === 'HARD'
                  ? 'border-[#ff0033]/80 text-[#ff0033] bg-[#ff0033]/15'
                  : 'border-[#38bdf8]/70 text-[#38bdf8] bg-[#38bdf8]/10'
              }`}
              title={`Dificultad activa: ${DIFFICULTY_CONFIG[difficulty].label} | Crecimiento IDS: ${DIFFICULTY_CONFIG[difficulty].idsMultiplier}x | Penalización por fallo: -${DIFFICULTY_CONFIG[difficulty].errorScorePenalty} PTS / +${DIFFICULTY_CONFIG[difficulty].errorIdsIncrement}% IDS | Rango S+: <${formatShortTimeLimit(DIFFICULTY_CONFIG[difficulty].sPlusMaxSeconds)}`}
            >
              MODO: {DIFFICULTY_CONFIG[difficulty].shortLabel} ({DIFFICULTY_CONFIG[difficulty].idsMultiplier}x IDS)
            </span>
          </div>

          <div
            id="ids-alert-hud"
            className={`ids-threat-box ${
              threatLevel >= 100
                ? 'locked-state'
                : threatLevel > 80
                ? 'high-orange-state'
                : ''
            }`}
            title="Alerta de Intrusión (IDS): incrementa gradualmente al ejecutar escaneos o cometer errores de comando. Al superar el 80% activa alerta naranja con parpadeo agresivo antes del bloqueo al 100%."
          >
            <div className="ids-threat-label-row">
              <div className="ids-threat-title-group">
                <span
                  id="ids-alert-label"
                  className={threatLevel > 80 && threatLevel < 100 ? 'ids-value-flicker font-bold' : ''}
                >
                  ALERTA IDS:
                </span>
                <span className="ids-mac-pill" title="Dirección MAC actual de la interfaz wlan0mon">
                  MAC {operatorSpoofedMac}
                </span>
                {godModeSecondsLeft > 0 && (
                  <span
                    id="god-mode-hud-badge"
                    className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-[#00ff41] text-black animate-pulse"
                    title="Comando oculto 'god_mode' activo: el incremento de la barra IDS está deshabilitado"
                  >
                    ⚡ GOD_MODE: {godModeSecondsLeft}s (0% IDS)
                  </span>
                )}
              </div>
              <div className="ids-status-group">
                {idsDeltaToast && (
                  <span
                    key={idsDeltaToast.id}
                    id="ids-delta-badge"
                    className={`ids-delta-pill ${
                      idsDeltaToast.isReset
                        ? 'reset'
                        : threatLevel > 80
                        ? 'critical'
                        : 'increase'
                    }`}
                  >
                    {idsDeltaToast.isReset
                      ? `0% [${idsDeltaToast.reason}]`
                      : `+${idsDeltaToast.delta}% [${idsDeltaToast.reason}]`}
                  </span>
                )}
                <span
                  id="ids-alert-value"
                  className={
                    threatLevel >= 100
                      ? 'text-[#ff0033] font-bold'
                      : threatLevel > 80
                      ? 'ids-value-flicker font-bold'
                      : threatLevel >= 50
                      ? 'text-[#ffbd2e]'
                      : 'text-[#00ff41]'
                  }
                >
                  {threatLevel}%{' '}
                  {threatLevel >= 100
                    ? '[BLOQUEADO]'
                    : threatLevel > 80
                    ? '[¡ALERTA CRÍTICA!]'
                    : threatLevel >= 50
                    ? '[SOSPECHA]'
                    : '[SIGILO]'}
                </span>
              </div>
            </div>
            <div
              id="ids-alert-bar"
              className={`ids-threat-track ${
                threatLevel >= 100
                  ? 'locked'
                  : threatLevel > 80
                  ? 'high-orange-track'
                  : ''
              }`}
              role="progressbar"
              aria-valuenow={threatLevel}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`ids-threat-fill ${
                  threatLevel > 80 ? 'high' : threatLevel >= 50 ? 'medium' : 'low'
                }`}
                style={{ width: `${threatLevel}%` }}
              />
              <div className="ids-threat-ticks" />
            </div>
            {threatLevel > 80 && threatLevel < 100 && (
              <div
                id="ids-prelock-warning"
                className="flex items-center justify-between gap-2 px-1.5 py-0.5 text-[10px] font-mono font-bold text-[#ff6a00] bg-[#ff5f00]/15 border border-[#ff6600] ids-value-flicker"
              >
                <span>
                  [!] RIESGO DE BLOQUEO (&gt;80% IDS) — Ejecuta &apos;macchanger&apos; antes del 100%
                </span>
                <button
                  type="button"
                  onClick={() => executeMacchangerRotation('macchanger -r wlan0mon')}
                  className="px-1.5 py-0.2 bg-black/80 border border-[#ff6600] text-[#ff8800] hover:bg-[#ff6600] hover:text-black cursor-pointer transition-colors"
                  title="Rotar dirección MAC preventivamente para reiniciar la barra IDS a 0%"
                >
                  SPOOF MAC
                </button>
              </div>
            )}
            {threatLevel >= 100 && (
              <div id="ids-lockdown-banner" className="ids-lockdown-banner">
                <span>[!] FIREWALL BLOQUEADO — Ejecuta: macchanger -r wlan0mon</span>
                <button
                  type="button"
                  className="ids-lockdown-cmd-btn"
                  onClick={() => executeMacchangerRotation('macchanger -r wlan0mon')}
                  title="Ejecutar 'macchanger -r wlan0mon' para rotar tu dirección MAC y desbloquear el IDS"
                >
                  ROTAR MAC
                </button>
              </div>
            )}
          </div>
        </div>
      )}

        <div className="fs-controls">
          <div className="fs-audio">
            <button
              id="mute-toggle-btn"
              type="button"
              onClick={handleToggleMute}
              className={`fs-ctl ${isMuted || masterVolume === 0 ? 'is-off' : 'is-on'}`}
              title={isMuted || masterVolume === 0 ? 'Activar el sonido' : 'Silenciar música y efectos'}
              aria-label={isMuted || masterVolume === 0 ? 'Activar el sonido' : 'Silenciar'}
              aria-pressed={isMuted || masterVolume === 0}
            >
              {isMuted || masterVolume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            <input
              id="volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : masterVolume}
              onChange={handleVolumeSliderChange}
              aria-label="Volumen"
              title={`Volumen: ${Math.round((isMuted ? 0 : masterVolume) * 100)} %`}
            />
          </div>

          {isGameActive && (
            <>
              <button
                id="toggle-map-btn"
                type="button"
                onClick={() => setIsNetworkMapOpen((prev) => !prev)}
                className={`fs-ctl ${isNetworkMapOpen ? 'is-on' : ''}`}
                title="Mostrar u ocultar el mapa de red"
                aria-pressed={isNetworkMapOpen}
              >
                <Network />
                <span>Red {compromisedCount}/5</span>
              </button>
              <button
                id="toggle-sniffer-btn"
                type="button"
                onClick={() => setIsSnifferOpen((prev) => !prev)}
                className={`fs-ctl ${isSnifferOpen ? 'is-on' : ''}`}
                title="Mostrar u ocultar el analizador de paquetes (tcpdump)"
                aria-pressed={isSnifferOpen}
              >
                <Activity />
                <span>Sniffer</span>
              </button>
              <button
                id="toggle-irc-btn"
                type="button"
                onClick={() => {
                  setIsIrcOpen((prev) => !prev);
                  setIsIrcMinimized(false);
                }}
                className={`fs-ctl ${isIrcOpen ? 'is-on' : ''}`}
                title="Mostrar u ocultar el chat IRC del equipo"
                aria-pressed={isIrcOpen}
              >
                <MessageSquare />
                <span>IRC</span>
                {unreadIrcCount > 0 && <b className="fs-ctl-count">{unreadIrcCount}</b>}
              </button>
            </>
          )}

          {sceneState !== 'SCENE_0' && sceneState !== 'TRANSITIONING' && (
            <>
              <button
                type="button"
                onClick={() => setIsMissionModalOpen(true)}
                className="fs-ctl"
                title="Ver la directiva de la operación"
              >
                <FileText />
                <span>Misión</span>
              </button>
              <button
                id="reset-save-btn"
                type="button"
                onClick={handleConfirmReset}
                className="fs-ctl is-danger"
                title="Borrar la partida guardada y volver al inicio"
              >
                <RotateCcw />
                <span>Reiniciar</span>
              </button>
            </>
          )}

          {IS_DEV_MODE && (
            <div className="fs-dev" title="Atajos de desarrollo (?dev)">
              {(
                [
                  ['Escena 2', triggerScene2Transition],
                  ['Escena 3', triggerScene3Transition],
                  ['Escena 4', triggerScene4Transition],
                  ['Escena 5', triggerScene5Transition],
                  ['Escena 6', triggerScene6Transition],
                ] as Array<[string, () => void]>
              ).map(([label, go]) => (
                <button key={label} type="button" onClick={go} className="fs-ctl">
                  <Terminal />
                  <span>{label}</span>
                </button>
              ))}
              <button id="preview-win-btn" type="button" onClick={triggerWinScreenTransition} className="fs-ctl">
                <FileDown />
                <span>Victoria</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ====================================================================
          ESCENA 0: PANTALLA DE BIENVENIDA + SPEEDRUN LEADERBOARD TOP 5
          ==================================================================== */}
      {sceneState === 'SCENE_0' || sceneState === 'TRANSITIONING' ? (
        <section
          id="scene-0"
          className={`scene-layer ${sceneState === 'TRANSITIONING' ? 'fade-out-black' : ''}`}
        >
          {/* Tabla de Clasificación Speedrun Top 5 en la pantalla de inicio */}
          {isStartLeaderboardOpen && (
            <div
              className="mission-modal-overlay open"
              role="dialog"
              aria-modal="true"
              aria-label="Ranking Speedrun Top 5"
              onClick={(e) => {
                if (e.target === e.currentTarget) setIsStartLeaderboardOpen(false);
              }}
            >
            <aside id="start-leaderboard" className="speedrun-leaderboard-panel fs-leaderboard-modal">
              <div className="leaderboard-header">
                <span className="leaderboard-title">
                  <Trophy className="w-3.5 h-3.5 text-[#00ff41]" />
                  <span>TOP 5 SPEEDRUN</span>
                </span>
                <button
                  type="button"
                  onClick={handleResetLeaderboard}
                  className="text-[10px] text-neutral-400 hover:text-[#ff0033] cursor-pointer"
                  title="Restablecer tabla de clasificación por defecto"
                >
                  [RESTABLECER]
                </button>
              </div>
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>ALIAS</th>
                    <th>UPTIME</th>
                    <th>RANGO</th>
                    <th>TAGS</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 5).map((entry, idx) => {
                    const pillCls =
                      entry.rank === 'S+'
                        ? 's-plus'
                        : entry.rank === 'A'
                        ? 'a'
                        : entry.rank === 'B'
                        ? 'b'
                        : 'c';
                    return (
                      <tr key={entry.id}>
                        <td className="text-[#00ff41] font-bold">0{idx + 1}</td>
                        <td className="font-semibold">{entry.alias}</td>
                        <td>{formatUptime(entry.elapsedSeconds).replace('UPTIME: ', '')}</td>
                        <td>
                          <span className={`rank-pill ${pillCls}`}>{entry.rank}</span>
                        </td>
                        <td className="text-[10px] text-neutral-400">
                          {entry.logsCleared ? 'GHOST ' : ''}
                          {entry.debugAuthUsed ? 'META' : ''}
                          {!entry.logsCleared && !entry.debugAuthUsed ? `${entry.score}p` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="button"
                onClick={() => setIsStartLeaderboardOpen(false)}
                className="mission-close-btn mt-4"
              >
                [ X CERRAR ]
              </button>
            </aside>
            </div>
          )}

          <header className="title-wrapper">
            <p className="system-kicker">CONEY ISLAND ARCADE · NODO 00</p>
            <h1 className="glitch-title" data-text="FSOCIETY CTF">
              FSOCIETY CTF
            </h1>
          </header>

          <div className="vn-bottom-dock">
            <article
              className="vn-dialogue-box"
              role="dialog"
              aria-label="Introducción de bienvenida"
            >
              <span className="vn-speaker-tag">MR. ROBOT</span>
              <p className="vn-dialogue-text">
                &ldquo;Hola, amigo. ¿Estás listo para derrocar a{' '}
                <span className="highlight-ecorp">ECorp</span>? El camino está lleno de
                vulnerabilidades. Entra si te atreves.&rdquo;
              </p>
            </article>

            {/* Selector de Nivel de Dificultad en Pantalla de Inicio */}
            <div
              id="difficulty-selector"
              className="w-full max-w-[920px] bg-black/90 border border-neutral-700/90 p-3 font-mono text-xs shadow-[0_0_24px_rgba(0,0,0,0.85)]"
              role="radiogroup"
              aria-label="Selector de dificultad de la operación"
            >
              <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-neutral-800 flex-wrap">
                <span className="text-[11px] font-bold tracking-widest text-[#f4f1ea] uppercase">
                  // SELECTOR DE DIFICULTAD DE INTRUSIÓN [PARÁMETROS IDS &amp; SPEEDRUN]
                </span>
                <span className="text-[11px] text-neutral-400">
                  ACTIVO:{' '}
                  <strong
                    className={
                      difficulty === 'EASY'
                        ? 'text-[#00ff41]'
                        : difficulty === 'HARD'
                        ? 'text-[#ff0033]'
                        : 'text-[#38bdf8]'
                    }
                  >
                    {DIFFICULTY_CONFIG[difficulty].label}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['EASY', 'NORMAL', 'HARD'] as DifficultyLevel[]).map((level) => {
                  const cfg = DIFFICULTY_CONFIG[level];
                  const isSelected = difficulty === level;
                  const activeBorderClass =
                    level === 'EASY'
                      ? 'border-[#00ff41] bg-[#00ff41]/12 text-[#00ff41]'
                      : level === 'HARD'
                      ? 'border-[#ff0033] bg-[#ff0033]/15 text-[#ff0033]'
                      : 'border-[#38bdf8] bg-[#38bdf8]/12 text-[#38bdf8]';

                  return (
                    <button
                      key={level}
                      id={`difficulty-btn-${level.toLowerCase()}`}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={sceneState === 'TRANSITIONING'}
                      onClick={() => {
                        setDifficulty(level);
                        difficultyRef.current = level;
                        playTypingSfx('Enter');
                      }}
                      className={`text-left p-2.5 border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                        isSelected
                          ? `${activeBorderClass} shadow-[0_0_12px_rgba(0,255,65,0.15)]`
                          : 'border-neutral-800 bg-neutral-950/80 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs tracking-wider">
                          [{isSelected ? '●' : '○'}] {cfg.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-300 leading-snug">{cfg.subtitle}</p>
                      <div className="grid grid-cols-3 gap-1 pt-1.5 mt-0.5 border-t border-neutral-800/90 text-[10px] text-neutral-200">
                        <div>
                          <span className="text-neutral-500 block">CREC. IDS</span>
                          <span className="font-bold">{cfg.idsMultiplier}x</span>
                        </div>
                        <div>
                          <span className="text-neutral-500 block">FALLO CMD</span>
                          <span className="font-bold">
                            -{cfg.errorScorePenalty}p / +{cfg.errorIdsIncrement}%
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-500 block">META S+ / A</span>
                          <span className="font-bold">
                            &lt;{formatShortTimeLimit(cfg.sPlusMaxSeconds)} / &lt;
                            {formatShortTimeLimit(cfg.fastMaxSeconds)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="vn-action-buttons">
              <button
                id="start-btn"
                type="button"
                onClick={handleStartConnection}
                disabled={sceneState === 'TRANSITIONING'}
                className="terminal-start-btn"
              >
                [ INICIAR CONEXIÓN ]
              </button>

              <button
                id="mission-btn"
                type="button"
                onClick={() => setIsMissionModalOpen(true)}
                disabled={sceneState === 'TRANSITIONING'}
                className="terminal-mission-btn"
              >
                [ VER MISIÓN ]
              </button>

              <button
                type="button"
                onClick={() => setIsStartLeaderboardOpen((prev) => !prev)}
                disabled={sceneState === 'TRANSITIONING'}
                className="terminal-mission-btn"
              >
                [ RANKING TOP 5 ]
              </button>

            </div>

            <footer className="fs-start-footer">
              <span>
                Simulador educativo: todos los sistemas, direcciones y credenciales son ficticios.
                Proyecto de fans sin relación con los titulares de <em>Mr. Robot</em>.
              </span>
              <span>
                <a href={HOUSE_URL} target="_blank" rel="noopener noreferrer">
                  unfantasmaenelsistema.com
                </a>
                {' · '}
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                  Código en GitHub
                </a>
              </span>
            </footer>
          </div>
        </section>
      ) : null}

      {/* ====================================================================
          SEGUNDA VENTANA FLOTANTE: NETWORK TOPOLOGY (#network-map)
          ==================================================================== */}
      {isNetworkMapOpen && isGameActive && (
        <div
          id="network-map"
          ref={netMapRef}
          className={isNetworkMapMinimized ? 'minimized' : ''}
          style={{ left: `${netMapPos.x}px`, top: `${netMapPos.y}px`, width: `${sidePanel.w}px` }}
        >
          <div id="network-map-header" onMouseDown={handleMapHeaderMouseDown}>
            <div className="kali-window-controls">
              <span
                className="kali-btn close cursor-pointer"
                title="Ocultar Network Topology"
                onClick={() => setIsNetworkMapOpen(false)}
              />
              <span
                className="kali-btn minimize cursor-pointer"
                title="Minimizar / Restaurar"
                onClick={() => setIsNetworkMapMinimized((prev) => !prev)}
              />
              <span className="kali-btn maximize" />
            </div>
            <span className="kali-title">Topología de red</span>
            <button
              id="minimize-map-btn"
              type="button"
              onClick={() => setIsNetworkMapMinimized((prev) => !prev)}
              title={isNetworkMapMinimized ? 'Restaurar mapa' : 'Minimizar mapa'}
            >
              [-]
            </button>
          </div>

          <div className="network-grid-body">
            <div className="topology-subtitle">
              <span>RED ECORP</span>
              <span>{compromisedCount}/5 COMPROMETIDOS</span>
            </div>

            {/* Lienzo interactivo D3.js Force-Directed Topology */}
            <div className="d3-topology-stage" title="Arrastra los nodos o haz clic para inspeccionar su telemetría">
              <svg
                id="d3-topology-svg"
                ref={d3TopologySvgRef}
                viewBox="0 0 360 176"
                preserveAspectRatio="xMidYMid meet"
              />
            </div>

            {/* Inspector interactivo del nodo seleccionado en el grafo D3 */}
            <div className="flex items-center justify-between px-2 py-1 rounded bg-black/70 border border-white/10 text-[10px] font-mono">
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    inspectedNode.owned
                      ? 'bg-[#00ff00] shadow-[0_0_8px_#00ff00] animate-pulse'
                      : 'bg-[#ff0033] shadow-[0_0_6px_#ff0033]'
                  }`}
                />
                <span className="text-white font-bold">
                  [{inspectedNode.code}] {inspectedNode.name}
                </span>
                <span className="text-cyan-300/90">{inspectedNode.ip}</span>
                <span className="text-neutral-400 truncate">{inspectedNode.service}</span>
              </div>
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider ${
                  inspectedNode.owned
                    ? 'bg-[#00ff00]/20 text-[#00ff41] border border-[#00ff00]/50'
                    : 'bg-[#ff0033]/20 text-[#ff4d6d] border border-[#ff0033]/40'
                }`}
              >
                {inspectedNode.owned ? 'COMPROMETIDO' : 'BLOQUEADO'}
              </span>
            </div>

            <div className="topology-legend">
              <span className="legend-item">
                <i className="legend-dot locked" /> Bloqueado
              </span>
              <span className="legend-item">
                <i className="legend-dot owned" /> Comprometido
              </span>
              <span className="legend-item text-neutral-500">Arrastra o pulsa un nodo</span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          TERCERA MICRO-VENTANA FLOTANTE: MINI-WIRESHARK / TCPDUMP (#packet-sniffer)
          ==================================================================== */}
      {isSnifferOpen && isGameActive && (
        <div
          id="packet-sniffer"
          ref={snifferRef}
          className={isSnifferMinimized ? 'minimized' : ''}
          style={{ left: `${snifferPos.x}px`, top: `${snifferPos.y}px` }}
        >
          <div id="packet-sniffer-header" onMouseDown={handleSnifferHeaderMouseDown}>
            <div className="kali-window-controls">
              <span
                className="kali-btn close cursor-pointer"
                title="Cerrar Packet Sniffer"
                onClick={() => setIsSnifferOpen(false)}
              />
              <span
                className="kali-btn minimize cursor-pointer"
                title="Minimizar / Restaurar Packet Sniffer"
                onClick={() => setIsSnifferMinimized((prev) => !prev)}
              />
              <span className="kali-btn maximize" />
            </div>
            <span className="kali-title">tcpdump // Mini-Wireshark (wlan0mon)</span>
            <button
              type="button"
              onClick={() => setIsSnifferMinimized((prev) => !prev)}
              className="text-xs font-mono text-[#00ff41] border border-neutral-600 px-1.5 py-0.5 hover:bg-[#00ff41] hover:text-black transition-colors cursor-pointer"
            >
              [-]
            </button>
          </div>

          <div className="sniffer-body">
            <div className="flex items-center justify-between text-[10px] text-neutral-400">
              <span>LIVE CAPTURE: {SNIFFER_PACKETS.length} FRAMES</span>
              <span className="text-[#00ff41]">MAC: {operatorSpoofedMac}</span>
            </div>

            <div className="sniffer-packet-list">
              {SNIFFER_PACKETS.map((pkt, idx) => (
                <div
                  key={pkt.id}
                  onClick={() => setSelectedPacketIdx(idx)}
                  className={`sniffer-packet-row ${selectedPacketIdx === idx ? 'selected' : ''} ${
                    pkt.isEvilPortal ? 'evil-portal-hit' : ''
                  }`}
                >
                  <span>{pkt.id}</span>
                  <span>{pkt.src}</span>
                  <span>{pkt.dst}</span>
                  <span>{pkt.proto}</span>
                  <span>{pkt.info}</span>
                </div>
              ))}
            </div>

            <div className="sniffer-hex-pane">
              {SNIFFER_PACKETS[selectedPacketIdx]?.hexDump || SNIFFER_PACKETS[0].hexDump}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          CUARTA MICRO-VENTANA FLOTANTE / ACOPLABLE: CHAT IRC (#fsociety-irc)
          ==================================================================== */}
      {isIrcOpen && isGameActive && (
        <div
          id="fsociety-irc"
          ref={ircRef}
          className={`${isIrcMinimized ? 'minimized' : ''} ${isIrcDocked ? 'docked' : ''}`}
          style={
            isIrcDocked
              ? undefined
              : {
                  left: `${ircPos.x}px`,
                  top: `${ircPos.y}px`,
                  width: `${sidePanel.w}px`,
                  height: isIrcMinimized ? undefined : `${sidePanel.ircH}px`,
                }
          }
        >
          <div id="fsociety-irc-header" onMouseDown={handleIrcHeaderMouseDown}>
            <div className="kali-window-controls">
              <span
                className="kali-btn close cursor-pointer"
                title="Ocultar #fsociety-irc"
                onClick={() => setIsIrcOpen(false)}
              />
              <span
                className="kali-btn minimize cursor-pointer"
                title="Minimizar / Restaurar #fsociety-irc"
                onClick={() => setIsIrcMinimized((prev) => !prev)}
              />
              <span
                className="kali-btn maximize cursor-pointer"
                title="Acoplar / Desacoplar ventana IRC"
                onClick={() => setIsIrcDocked((prev) => !prev)}
              />
            </div>
            <span className="kali-title">irc.colo-solutions.net // #fsociety-op</span>
            <div className="irc-header-actions">
              <button
                type="button"
                onClick={() => setIsIrcDocked((prev) => !prev)}
                className="irc-header-btn"
                title={
                  isIrcDocked
                    ? 'Desacoplar para arrastrar libremente'
                    : 'Acoplar a la esquina inferior derecha'
                }
              >
                {isIrcDocked ? '[FLOAT]' : '[DOCK]'}
              </button>
              <button
                type="button"
                onClick={() => setIsIrcMinimized((prev) => !prev)}
                className="irc-header-btn"
                title={isIrcMinimized ? 'Restaurar IRC' : 'Minimizar IRC'}
              >
                [-]
              </button>
            </div>
          </div>

          <div className="irc-body">
            <div className="irc-topic-bar">
              <span>TOPIC: OP STEEL MOUNTAIN / ECORP VAULT</span>
              <span className="text-[#00ff41]">+tls +secret</span>
            </div>

            <div className="irc-users-bar">
              <span className="text-[#ff0033] font-bold">@mr_robot</span>
              <span className="text-[#00ff41] font-bold">@d0loresH4ze</span>
              <span className="text-[#ffbd2e] font-bold">+ph4nt0m_romero</span>
              <span className="text-[#38bdf8] font-bold">sam_sepi0l</span>
            </div>

            <div className="irc-messages-list" ref={ircListRef}>
              {ircMessages.map((msg) => (
                <div key={msg.id} className="irc-msg-row">
                  <span className="irc-msg-time">[{msg.time}]</span>
                  <span className={`irc-msg-sender ${msg.senderRole}`}>&lt;{msg.nick}&gt;</span>
                  <span className="text-neutral-200">{msg.text}</span>
                </div>
              ))}
            </div>

            <form className="irc-input-form" onSubmit={handleSendIrcMessage}>
              <span className="irc-input-nick">&lt;sam_sepi0l&gt;</span>
              <input
                type="text"
                value={ircInput}
                onChange={(e) => setIrcInput(e.target.value)}
                onKeyDown={() => playTypingSfx()}
                placeholder="Escribe a Darlene, Mr. Robot o Romero..."
                className="irc-input-field"
                autoComplete="off"
                spellCheck={false}
              />
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          ESCENAS 1 A 6: TERMINAL FLOTANTE (#kali-terminal.crt-effect)
          ==================================================================== */}
      <section
        id="scene-1"
        className={
          sceneState !== 'SCENE_0' && sceneState !== 'TRANSITIONING' && sceneState !== 'WIN'
            ? ''
            : 'hidden'
        }
      >
        <div
          id="kali-terminal"
          ref={terminalRef}
          className={`crt-effect theme-${terminalTheme} ${
            isTerminalBlurred ? 'paranoia-blur-active' : ''
          }`}
          style={{
            left: `${termPos.x}px`,
            top: `${termPos.y}px`,
            width: `${termSize.w}px`,
            height: `${termSize.h}px`,
          }}
          onClick={() => {
            const selection = window.getSelection();
            if (!selection || selection.toString().length === 0) {
              inputRef.current?.focus();
            }
          }}
        >
          {/* Barra superior (header) gris oscuro arrastrable */}
          <div id="kali-header" onMouseDown={handleHeaderMouseDown}>
            <div className="kali-window-controls">
              <span className="kali-btn close" />
              <span className="kali-btn minimize" />
              <span className="kali-btn maximize" />
            </div>
            <span className="kali-title">{windowTitle}</span>
            <button
              id="terminal-theme-badge"
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (!isExecuting) {
                  const nextProfile =
                    terminalTheme === 'matrix'
                      ? 'Dracula'
                      : terminalTheme === 'dracula'
                        ? 'Monokai'
                        : 'Matrix';
                  processCommand(`theme ${nextProfile}`);
                  inputRef.current?.focus();
                }
              }}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/15 bg-black/50 text-neutral-200 hover:border-white/40 cursor-pointer transition-colors"
              title="Cambiar perfil de color de la terminal (Comando: theme Matrix | Dracula | Monokai)"
            >
              TEMA: {terminalTheme.toUpperCase()}
            </button>
          </div>

          {/* Monólogo interior de Elliot: franja propia, no tapa la salida ni la entrada */}
          {monologueNode}

          {/* Área de salida de texto con scroll */}
          <div id="terminal-output" ref={outputRef}>
            {terminalLogs.map((entry) =>
              entry.type === 'logdump' ? (
                <div key={entry.id} className="terminal-logdump-container">
                  <div className="terminal-logdump-header">
                    <span>/var/log/ecorp_siem_audit.log — VOLCADO DE ACCESOS DEL SISTEMA</span>
                    <span>[26 EVENTOS · SCROLLABLE]</span>
                  </div>
                  <div className="terminal-logdump-scroll" tabIndex={0}>
                    {entry.text}
                  </div>
                </div>
              ) : entry.type === 'top' ? (
                (() => {
                  const nowTime = new Date().toTimeString().split(' ')[0];
                  const isTamperActive = Date.now() < topTelemetry.tamperSpikeUntil;
                  const totalCpuUsed = Math.min(
                    99.9,
                    Number(
                      (
                        topTelemetry.secCpu +
                        topTelemetry.siemCpu +
                        topTelemetry.nodeCpu +
                        topTelemetry.dbCpu * 0.45 +
                        topTelemetry.logCpu * 0.35 +
                        topTelemetry.sysCpu
                      ).toFixed(1)
                    )
                  );
                  const idleCpu = Math.max(0, Number((100 - totalCpuUsed).toFixed(1)));
                  const iowaitCpu = Number(
                    Math.min(12.4, topTelemetry.diskWriteMb * 0.14).toFixed(1)
                  );

                  const totalMemPercent = Math.min(
                    98.5,
                    Number(
                      (
                        topTelemetry.secMem +
                        topTelemetry.siemMem +
                        topTelemetry.nodeMem +
                        topTelemetry.dbMem +
                        topTelemetry.logMem +
                        topTelemetry.syncMem +
                        topTelemetry.camMem +
                        3.4
                      ).toFixed(1)
                    )
                  );
                  const usedMemMb = Math.round((totalMemPercent / 100) * 16384);
                  const cacheMemMb = topTelemetry.cacheMemMb;
                  const freeMemMb = Math.max(256, 16384 - usedMemMb - cacheMemMb);
                  const swapPercent = Number(((topTelemetry.swapUsedMb / 4096) * 100).toFixed(1));

                  const cpuFilledBars = Math.max(1, Math.min(20, Math.round(totalCpuUsed / 5)));
                  const memFilledBars = Math.max(1, Math.min(20, Math.round(totalMemPercent / 5)));
                  const swapFilledBars = Math.max(1, Math.min(20, Math.round(swapPercent / 5)));
                  const cpuAsciiBar = `${'|'.repeat(cpuFilledBars)}${'.'.repeat(20 - cpuFilledBars)}`;
                  const memAsciiBar = `${'|'.repeat(memFilledBars)}${'.'.repeat(20 - memFilledBars)}`;
                  const swapAsciiBar = `${'|'.repeat(swapFilledBars)}${'.'.repeat(20 - swapFilledBars)}`;

                  const nodeServiceCmd =
                    sceneState === 'SCENE_1'
                      ? 'mysqld --datadir=/var/lib/mysql --ecorp-db'
                      : sceneState === 'SCENE_2'
                        ? 'vsftpd /etc/vsftpd.conf --anon-spool'
                        : sceneState === 'SCENE_3'
                          ? 'smbd --foreground --configfile=/etc/samba/smb.conf'
                          : sceneState === 'SCENE_4'
                            ? 'sshd: ceo@pts/0 [ecorp-executive-node]'
                            : sceneState === 'SCENE_5'
                              ? 'streamd --rtsp-port 554 --corridor-b3'
                              : 'vaultd-serial --device /dev/ttyUSB0 --baud 9600';

                  const isCamStopped = sceneState === 'SCENE_5' && exteriorStep >= 7;

                  interface SimulatedProcessRow {
                    pid: number;
                    user: string;
                    pr: string;
                    ni: string;
                    virt: string;
                    resMb: number;
                    state: 'R' | 'S' | 'D' | 'Z';
                    cpu: number;
                    mem: number;
                    timeSeconds: number;
                    timeStr: string;
                    threads: number;
                    cgroup: string;
                    sockets: string;
                    command: string;
                    isCritical?: boolean;
                  }

                  const formatProcTime = (baseSec: number) => {
                    const total = baseSec + topTelemetry.tickCount;
                    const mins = Math.floor(total / 60);
                    const secs = total % 60;
                    const hundredths = (topTelemetry.tickCount * 17) % 100;
                    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
                  };

                  const allProcesses: SimulatedProcessRow[] = [
                    {
                      pid: 1337,
                      user: 'root',
                      pr: '-20',
                      ni: '-20',
                      virt: '8420m',
                      resMb: topTelemetry.secResMb,
                      state: 'R',
                      cpu: topTelemetry.secCpu,
                      mem: topTelemetry.secMem,
                      timeSeconds: 854,
                      timeStr: formatProcTime(854),
                      threads: 24,
                      cgroup: '/system.slice/ecorp-edr-watchdog.service [Ring-0 Protected]',
                      sockets: 'RAW:0.0.0.0:* · NETLINK_AUDIT · /dev/ecorp_watchdog0',
                      command: 'ecorp_sec_agent --edr-watchdog [CRÍTICO]',
                      isCritical: true,
                    },
                    {
                      pid: 884,
                      user: 'allsafe',
                      pr: '20',
                      ni: '0',
                      virt: '2140m',
                      resMb: Math.round((topTelemetry.siemMem / 100) * 16384),
                      state: threatLevel >= 50 ? 'R' : 'S',
                      cpu: topTelemetry.siemCpu,
                      mem: topTelemetry.siemMem,
                      timeSeconds: 512,
                      timeStr: formatProcTime(512),
                      threads: 12,
                      cgroup: '/system.slice/allsafe-ids.service',
                      sockets: `UDP:10.10.10.5:514 (IDS=${threatLevel}%) · AF_PACKET:wlan0mon`,
                      command: `allsafe_ids_sensor --iface wlan0mon --alert=${threatLevel}%`,
                    },
                    {
                      pid: 3102,
                      user: 'mysql',
                      pr: '20',
                      ni: '0',
                      virt: '3280m',
                      resMb: Math.round((topTelemetry.dbMem / 100) * 16384),
                      state: 'S',
                      cpu: topTelemetry.dbCpu,
                      mem: topTelemetry.dbMem,
                      timeSeconds: 438,
                      timeStr: formatProcTime(438),
                      threads: 18,
                      cgroup: '/system.slice/mariadb-ecorp.service',
                      sockets: 'TCP:127.0.0.1:3306 (LISTEN) · /run/mysqld/mysqld.sock',
                      command: 'mariadbd --basedir=/usr --datadir=/var/lib/mysql/ecorp_db',
                    },
                    {
                      pid: 2048,
                      user: 'ecorp',
                      pr: '20',
                      ni: '0',
                      virt: '1890m',
                      resMb: Math.round((topTelemetry.nodeMem / 100) * 16384),
                      state: 'R',
                      cpu: topTelemetry.nodeCpu,
                      mem: topTelemetry.nodeMem,
                      timeSeconds: 319,
                      timeStr: formatProcTime(319),
                      threads: 8,
                      cgroup: `/ecorp.slice/scene-${sceneState.toLowerCase()}.service`,
                      sockets: 'TCP:0.0.0.0:80,21,445,22 (ACTIVE_NODE_DAEMON)',
                      command: nodeServiceCmd,
                    },
                    {
                      pid: 412,
                      user: 'ecorp',
                      pr: '20',
                      ni: '0',
                      virt: '940m',
                      resMb: isCamStopped ? 0 : Math.round((topTelemetry.camMem / 100) * 16384),
                      state: isCamStopped ? 'Z' : 'S',
                      cpu: topTelemetry.camCpu,
                      mem: topTelemetry.camMem,
                      timeSeconds: 205,
                      timeStr: formatProcTime(205),
                      threads: isCamStopped ? 0 : 6,
                      cgroup: '/iot.slice/cam-01-rtsp.service',
                      sockets: isCamStopped
                        ? 'CLOSED (SIGTERM recibido)'
                        : 'TCP:192.168.99.20:554 (RTSP_FEED)',
                      command: isCamStopped
                        ? '[streamd] <defunct> (CCTV detenido)'
                        : 'streamd --rtsp :554 --corridor-b3-feed',
                    },
                    {
                      pid: 1984,
                      user: 'allsafe',
                      pr: '20',
                      ni: '0',
                      virt: '1120m',
                      resMb: Math.round((topTelemetry.logMem / 100) * 16384),
                      state: logsCleared ? 'D' : 'S',
                      cpu: topTelemetry.logCpu,
                      mem: topTelemetry.logMem,
                      timeSeconds: 274,
                      timeStr: formatProcTime(274),
                      threads: 4,
                      cgroup: '/system.slice/ecorp-siem-forwarder.service',
                      sockets: logsCleared
                        ? '/var/log/auth.log (SHREDDED / INODE MISSING)'
                        : '/var/log/ecorp_siem_audit.log -> 10.10.10.5:514',
                      command: logsCleared
                        ? 'ecorp_log_collector --status=LOGS_WIPED'
                        : 'ecorp_log_collector --syslog /var/log/auth.log',
                    },
                    {
                      pid: 2600,
                      user: 'ecorp',
                      pr: '25',
                      ni: '5',
                      virt: '1460m',
                      resMb: Math.round((topTelemetry.syncMem / 100) * 16384),
                      state: 'S',
                      cpu: topTelemetry.syncCpu,
                      mem: topTelemetry.syncMem,
                      timeSeconds: 162,
                      timeStr: formatProcTime(162),
                      threads: 5,
                      cgroup: '/vault.slice/steel-mountain-sync.service',
                      sockets: 'TLS:10.10.99.99:8443 (AES-256-GCM)',
                      command: 'tape_vault_sync --steel-mountain --aes256',
                    },
                    {
                      pid: 1,
                      user: 'root',
                      pr: '20',
                      ni: '0',
                      virt: '168m',
                      resMb: 12,
                      state: 'S',
                      cpu: 0.2,
                      mem: 0.1,
                      timeSeconds: 1420,
                      timeStr: formatProcTime(1420),
                      threads: 1,
                      cgroup: '/init.scope',
                      sockets: '/run/systemd/private',
                      command: '/sbin/init --ecorp-enterprise',
                    },
                  ];

                  const filteredProcesses = allProcesses
                    .filter((p) =>
                      topUserFilter === 'ALL' ? true : p.user.toLowerCase() === topUserFilter
                    )
                    .sort((a, b) => {
                      if (topSortBy === 'cpu') return b.cpu - a.cpu;
                      if (topSortBy === 'mem') return b.mem - a.mem;
                      if (topSortBy === 'pid') return a.pid - b.pid;
                      return b.timeSeconds - a.timeSeconds;
                    });

                  const runningCount = allProcesses.filter((p) => p.state === 'R').length;
                  const zombieCount = allProcesses.filter((p) => p.state === 'Z').length;
                  const selectedProc =
                    allProcesses.find((p) => p.pid === topSelectedPid) ?? allProcesses[0];

                  return (
                    <div
                      key={entry.id}
                      id="top-resource-monitor"
                      className="my-2 border border-[#00ff41]/60 bg-black/95 p-2.5 font-mono text-xs shadow-[0_0_18px_rgba(0,255,65,0.16)]"
                    >
                      {/* Cabecera superior con controles dinámicos en tiempo real */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#00ff41]/30 pb-1.5 mb-2 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="text-[#00ff41] font-bold">
                            procps-ng top // MONITOR DINÁMICO DE RECURSOS Y PROCESOS ECORP
                          </span>
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold ${
                              isTamperActive
                                ? 'bg-[#ff0033] text-white animate-pulse'
                                : topPaused
                                  ? 'bg-[#ffbd2e]/20 text-[#ffbd2e] border border-[#ffbd2e]/50'
                                  : 'bg-[#00ff41]/15 text-[#00ff41] border border-[#00ff41]/40'
                            }`}
                          >
                            {isTamperActive
                              ? 'EDR TAMPER ALERT (+40% IDS)'
                              : topPaused
                                ? `PAUSED · TICK #${topTelemetry.tickCount}`
                                : `LIVE · TICK #${topTelemetry.tickCount}`}
                          </span>
                        </div>

                        {/* Controles interactivos de ordenación, filtro por usuario y pausa */}
                        <div className="flex flex-wrap items-center gap-1 text-[10px]">
                          <span className="text-neutral-400 mr-0.5">ORDEN:</span>
                          {(['cpu', 'mem', 'pid', 'time'] as const).map((field) => (
                            <button
                              key={field}
                              type="button"
                              onClick={() => {
                                playTypingSfx();
                                setTopSortBy(field);
                              }}
                              className={`px-1.5 py-0.5 border cursor-pointer uppercase transition-colors ${
                                topSortBy === field
                                  ? 'bg-[#00ff41] text-black border-[#00ff41] font-bold'
                                  : 'bg-black text-neutral-300 border-neutral-700 hover:border-[#00ff41]'
                              }`}
                            >
                              {field === 'cpu'
                                ? '%CPU'
                                : field === 'mem'
                                  ? '%MEM'
                                  : field === 'pid'
                                    ? 'PID'
                                    : 'TIME+'}
                            </button>
                          ))}
                          <span className="text-neutral-500 mx-0.5">|</span>
                          <span className="text-neutral-400 mr-0.5">USER:</span>
                          {(['ALL', 'root', 'allsafe', 'ecorp', 'mysql'] as const).map((usr) => (
                            <button
                              key={usr}
                              type="button"
                              onClick={() => {
                                playTypingSfx();
                                setTopUserFilter(usr);
                              }}
                              className={`px-1.5 py-0.5 border cursor-pointer transition-colors ${
                                topUserFilter === usr
                                  ? 'bg-[#38bdf8] text-black border-[#38bdf8] font-bold'
                                  : 'bg-black text-neutral-300 border-neutral-700 hover:border-[#38bdf8]'
                              }`}
                            >
                              {usr}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              playTypingSfx();
                              setTopPaused((prev) => !prev);
                            }}
                            className={`ml-1 px-1.5 py-0.5 border cursor-pointer font-bold transition-colors ${
                              topPaused
                                ? 'bg-[#ffbd2e] text-black border-[#ffbd2e]'
                                : 'bg-black text-[#00ff41] border-[#00ff41]/50 hover:bg-[#00ff41]/20'
                            }`}
                            title="Pausar o reanudar el refresco de telemetría en tiempo real"
                          >
                            {topPaused ? '[▶ REANUDAR]' : '[⏸ PAUSAR]'}
                          </button>
                        </div>
                      </div>

                      {/* Resumen clásico de procps-ng top */}
                      <div className="space-y-0.5 text-[11px] text-neutral-300 mb-2 leading-relaxed">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span>
                            top - {nowTime} up {formatUptime(elapsedSeconds).replace('UPTIME: ', '')},
                            1 user, load average:{' '}
                            <span className="text-white font-bold">{topTelemetry.load1}</span>,{' '}
                            {topTelemetry.load5}, {topTelemetry.load15}
                          </span>
                          <span className="text-cyan-300">
                            NET RX: <strong>{topTelemetry.netRxKbps} KB/s</strong> · TX:{' '}
                            <strong>{topTelemetry.netTxKbps} KB/s</strong> | DISK R/W:{' '}
                            <strong>
                              {topTelemetry.diskReadMb}/{topTelemetry.diskWriteMb} MB/s
                            </strong>
                          </span>
                        </div>
                        <div>
                          Tasks: <span className="text-white font-bold">142</span> total,{' '}
                          <span className="text-[#00ff41] font-bold">{runningCount}</span> running,{' '}
                          {142 - runningCount - zombieCount} sleeping, 0 stopped,{' '}
                          <span className={zombieCount > 0 ? 'text-[#ff5f56] font-bold' : ''}>
                            {zombieCount} zombie
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            %Cpu(s):{' '}
                            <span className="text-[#ff5f56] font-bold">
                              {totalCpuUsed.toFixed(1)}
                            </span>{' '}
                            us,{' '}
                            <span className="text-[#ffbd2e]">
                              {topTelemetry.sysCpu.toFixed(1)}
                            </span>{' '}
                            sy, <span className="text-neutral-400">{idleCpu.toFixed(1)} id</span>,{' '}
                            <span className="text-cyan-300">{iowaitCpu.toFixed(1)} wa</span>
                          </span>
                          <span className="text-[#00ff41]">[{cpuAsciiBar}]</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            MiB Mem : <span className="text-white">16384.0</span> total,{' '}
                            <span className="text-neutral-400">{freeMemMb}.0</span> free,{' '}
                            <span className="text-[#ffbd2e] font-bold">
                              {usedMemMb}.0 used ({totalMemPercent.toFixed(1)}%)
                            </span>
                            , <span className="text-cyan-300">{cacheMemMb}.0 buff/cache</span>
                          </span>
                          <span className="text-[#ffbd2e]">[{memAsciiBar}]</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            MiB Swap: <span className="text-white">4096.0</span> total,{' '}
                            <span className="text-neutral-400">
                              {4096 - topTelemetry.swapUsedMb}.0
                            </span>{' '}
                            free,{' '}
                            <span className="text-purple-400 font-bold">
                              {topTelemetry.swapUsedMb}.0 used ({swapPercent.toFixed(1)}%)
                            </span>
                          </span>
                          <span className="text-purple-400">[{swapAsciiBar}]</span>
                        </div>
                      </div>

                      {/* ================================================================
                          VISTA DE CONSUMO DE RECURSOS EN TIEMPO REAL (4 CORES + RAM/SWAP + SPARKLINE)
                          ================================================================ */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2.5 p-2 rounded bg-neutral-950/90 border border-neutral-800">
                        {/* Columna Izquierda: Medidores de los 4 Núcleos Xeon en tiempo real */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-neutral-400 border-b border-neutral-800 pb-0.5">
                            <span className="font-bold text-[#00ff41]">
                              ECORP XEON 4-CORE LOAD (REAL-TIME)
                            </span>
                            <span>AVG: {totalCpuUsed.toFixed(1)}%</span>
                          </div>
                          {topTelemetry.cores.map((coreLoad, idx) => {
                            const barColor =
                              coreLoad > 80
                                ? 'bg-[#ff0033]'
                                : coreLoad > 55
                                  ? 'bg-[#ffbd2e]'
                                  : 'bg-[#00ff41]';
                            return (
                              <div key={idx} className="flex items-center gap-1.5 text-[10px]">
                                <span className="w-9 text-neutral-300 font-bold">CPU{idx}</span>
                                <div className="flex-1 h-2 bg-neutral-900 border border-neutral-800 overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-300 ${barColor}`}
                                    style={{ width: `${Math.min(100, coreLoad)}%` }}
                                  />
                                </div>
                                <span
                                  className={`w-11 text-right font-bold ${
                                    coreLoad > 80
                                      ? 'text-[#ff5f56]'
                                      : coreLoad > 55
                                        ? 'text-[#ffbd2e]'
                                        : 'text-[#00ff41]'
                                  }`}
                                >
                                  {coreLoad.toFixed(1)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Columna Derecha: Distribución de Memoria e Historial de Consumo (Sparkline 20s) */}
                        <div className="space-y-1.5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between text-[10px] text-neutral-400 border-b border-neutral-800 pb-0.5 mb-1">
                              <span className="font-bold text-[#ffbd2e]">
                                DISTRIBUCIÓN RAM / SWAP &amp; HISTORIAL (20 TICKS)
                              </span>
                              <span>{usedMemMb} / 16384 MiB</span>
                            </div>
                            {/* Barra multicapa de Memoria RAM (Used + Cache + Free) */}
                            <div className="flex items-center gap-1.5 text-[10px] mb-1">
                              <span className="w-9 text-neutral-300 font-bold">RAM</span>
                              <div className="flex-1 h-2 bg-neutral-900 border border-neutral-800 flex overflow-hidden">
                                <div
                                  className="h-full bg-[#ffbd2e] transition-all duration-300"
                                  style={{ width: `${Math.min(100, totalMemPercent)}%` }}
                                  title={`Usada por procesos: ${usedMemMb} MiB`}
                                />
                                <div
                                  className="h-full bg-cyan-500/60 transition-all duration-300"
                                  style={{
                                    width: `${Math.min(
                                      100 - totalMemPercent,
                                      (cacheMemMb / 16384) * 100
                                    )}%`,
                                  }}
                                  title={`Buffers/Cache: ${cacheMemMb} MiB`}
                                />
                              </div>
                              <span className="w-11 text-right text-[#ffbd2e] font-bold">
                                {totalMemPercent.toFixed(1)}%
                              </span>
                            </div>

                            {/* Mini-histograma / Sparkline en tiempo real de CPU ( últimos 20 segundos ) */}
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <span className="w-9 text-neutral-400">HIST</span>
                              <div className="flex-1 h-5 bg-black/80 border border-neutral-800 px-1 py-0.5 flex items-end gap-0.5">
                                {topTelemetry.cpuHistory.map((val, hIdx) => (
                                  <div
                                    key={hIdx}
                                    className={`flex-1 transition-all duration-300 ${
                                      val > 80
                                        ? 'bg-[#ff0033]'
                                        : val > 55
                                          ? 'bg-[#ffbd2e]'
                                          : 'bg-[#00ff41]'
                                    }`}
                                    style={{ height: `${Math.max(15, Math.min(100, val))}%` }}
                                    title={`Tick -${topTelemetry.cpuHistory.length - hIdx}s: ${val}% CPU`}
                                  />
                                ))}
                              </div>
                              <span className="w-11 text-right text-[9px] text-neutral-400">
                                20s CPU
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Tabla dinámica de procesos del sistema ECorp */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-[#00ff41] text-black font-bold select-none">
                              <th
                                className="px-1.5 py-0.5 cursor-pointer hover:underline"
                                onClick={() => setTopSortBy('pid')}
                              >
                                PID {topSortBy === 'pid' ? '▲' : ''}
                              </th>
                              <th className="px-1.5 py-0.5">USER</th>
                              <th className="px-1.5 py-0.5">PR</th>
                              <th className="px-1.5 py-0.5">VIRT</th>
                              <th className="px-1.5 py-0.5">RES</th>
                              <th className="px-1.5 py-0.5">S</th>
                              <th
                                className="px-1.5 py-0.5 cursor-pointer hover:underline"
                                onClick={() => setTopSortBy('cpu')}
                              >
                                %CPU {topSortBy === 'cpu' ? '▼' : ''}
                              </th>
                              <th
                                className="px-1.5 py-0.5 cursor-pointer hover:underline"
                                onClick={() => setTopSortBy('mem')}
                              >
                                %MEM {topSortBy === 'mem' ? '▼' : ''}
                              </th>
                              <th
                                className="px-1.5 py-0.5 cursor-pointer hover:underline"
                                onClick={() => setTopSortBy('time')}
                              >
                                TIME+ {topSortBy === 'time' ? '▼' : ''}
                              </th>
                              <th className="px-1.5 py-0.5">COMMAND</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-800">
                            {filteredProcesses.map((proc) => {
                              const isSelected = proc.pid === selectedProc.pid;
                              const rowCls = proc.isCritical
                                ? 'bg-[#d91424]/20 text-[#ff5f56] font-bold'
                                : proc.user === 'allsafe'
                                  ? 'text-[#ffbd2e]'
                                  : proc.user === 'mysql'
                                    ? 'text-cyan-300'
                                    : proc.user === 'ecorp'
                                      ? 'text-[#00ff41]'
                                      : 'text-neutral-400';

                              return (
                                <tr
                                  key={proc.pid}
                                  onClick={() => setTopSelectedPid(proc.pid)}
                                  className={`${rowCls} ${
                                    isSelected ? 'ring-1 ring-inset ring-white/40 bg-white/5' : ''
                                  } hover:bg-white/10 cursor-pointer transition-colors`}
                                  title="Haz clic para inspeccionar sockets y cgroup del proceso"
                                >
                                  <td className="px-1.5 py-1">{proc.pid}</td>
                                  <td className="px-1.5 py-1">{proc.user}</td>
                                  <td className="px-1.5 py-1">{proc.pr}</td>
                                  <td className="px-1.5 py-1">{proc.virt}</td>
                                  <td className="px-1.5 py-1">{proc.resMb}m</td>
                                  <td className="px-1.5 py-1">{proc.state}</td>
                                  <td className="px-1.5 py-1">
                                    <div className="flex items-center gap-1">
                                      <span
                                        className={
                                          proc.isCritical ? 'text-[#ff0033] font-bold' : ''
                                        }
                                      >
                                        {proc.cpu.toFixed(1)}%
                                      </span>
                                      <div className="w-8 h-1.5 bg-neutral-900 border border-neutral-800 hidden sm:block overflow-hidden">
                                        <div
                                          className={`h-full ${
                                            proc.isCritical ? 'bg-[#ff0033]' : 'bg-[#00ff41]'
                                          }`}
                                          style={{ width: `${Math.min(100, proc.cpu)}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-1.5 py-1">{proc.mem.toFixed(1)}%</td>
                                  <td className="px-1.5 py-1 text-[10px] opacity-90">
                                    {proc.timeStr}
                                  </td>
                                  <td className="px-1.5 py-1">{proc.command}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Inspector dinámico del proceso seleccionado en la tabla */}
                      <div className="mt-2 p-1.5 rounded bg-black/80 border border-neutral-800 text-[10px] text-neutral-300 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-[#00ff41] font-bold">
                            [INSPECT PID {selectedProc.pid}]
                          </span>{' '}
                          <span className="text-white">{selectedProc.cgroup}</span> ·{' '}
                          <span className="text-cyan-300">NLWP: {selectedProc.threads} hilos</span>
                        </div>
                        <div className="text-neutral-400">
                          SOCKETS/FD: <code className="text-neutral-200">{selectedProc.sockets}</code>
                        </div>
                      </div>

                      <div className="mt-2 pt-1.5 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400">
                        <span>
                          [!] Proceso crítico detectado:{' '}
                          <strong className="text-[#ff5f56]">
                            PID 1337 (ecorp_sec_agent)
                          </strong>{' '}
                          — Ejecutar <code className="text-white">kill 1337</code> o{' '}
                          <code className="text-white">kill -9 1337</code> disparará +40% de Alerta
                          IDS.
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (!isExecuting) {
                              processCommand('kill -9 1337');
                              inputRef.current?.focus();
                            }
                          }}
                          disabled={isExecuting}
                          className="px-2 py-0.5 border border-[#ff0033] bg-[#ff0033]/15 text-[#ff5f56] hover:bg-[#ff0033] hover:text-white font-bold cursor-pointer transition-colors"
                          title="Intentar terminar el proceso crítico de seguridad PID 1337 (Aumenta +40% la alerta IDS)"
                        >
                          [KILL PID 1337]
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div
                  key={entry.id}
                  className={`terminal-line ${
                    entry.type === 'cmd'
                      ? 'cmd-echo'
                      : entry.type === 'success'
                      ? 'system-success'
                      : ''
                  }`}
                >
                  {entry.text}
                </div>
              )
            )}
            {phantomHallucination && (
              <div className="terminal-line phantom-hallucination">{phantomHallucination}</div>
            )}
          </div>

          {/* Área de entrada */}
          <div className="terminal-input-row">
            {currentPrompt && (
              <label htmlFor="terminal-input" className="terminal-prompt">
                {currentPrompt}
              </label>
            )}
            <input
              id="terminal-input"
              ref={inputRef}
              type={isPasswordInput ? 'password' : 'text'}
              value={commandInput}
              readOnly={isExecuting}
              onChange={(e) => {
                if (!isExecuting) {
                  const val = e.target.value;
                  setCommandInput(val);
                  setHistoryDraftInput(val);
                  setHistoryIndex(commandHistory.length);
                }
              }}
              onKeyDown={handleInputKeyDown}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {!isPasswordInput && (
              <button
                id="terminal-tab-autocomplete-btn"
                type="button"
                onClick={() => {
                  if (!isExecuting) {
                    playTypingSfx('Tab');
                    triggerTabAutocomplete();
                    inputRef.current?.focus();
                  }
                }}
                disabled={isExecuting}
                className="text-[10px] font-mono text-[#38bdf8] border border-neutral-700 bg-black/70 px-1.5 py-0.5 ml-1.5 hover:bg-[#38bdf8] hover:text-black disabled:opacity-35 disabled:pointer-events-none cursor-pointer transition-colors shrink-0 select-none"
                title="Autocompletar comando de red o archivo del directorio virtual actual (Tecla Tab)"
              >
                [TAB]
              </button>
            )}
            {commandHistory.length > 0 && !isPasswordInput && (
              <div
                id="terminal-history-nav"
                className="flex items-center gap-1 ml-2 shrink-0 select-none"
                title="Historial de comandos en estado (Usa Flecha Arriba ↑ y Flecha Abajo ↓)"
              >
                <span className="text-[10px] font-mono text-neutral-400 px-1 border border-neutral-700 bg-black/60">
                  {historyIndex < commandHistory.length
                    ? `HIST ${historyIndex + 1}/${commandHistory.length}`
                    : `HIST:${commandHistory.length}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playTypingSfx();
                    navigateCommandHistory('up');
                  }}
                  disabled={isExecuting || historyIndex <= 0}
                  className="text-[10px] font-mono text-[#00ff41] border border-neutral-700 bg-black/70 px-1.5 py-0.5 hover:bg-[#00ff41] hover:text-black disabled:opacity-35 disabled:pointer-events-none cursor-pointer transition-colors"
                  title="Comando anterior (Flecha Arriba ↑)"
                  aria-label="Comando anterior"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playTypingSfx();
                    navigateCommandHistory('down');
                  }}
                  disabled={isExecuting || historyIndex >= commandHistory.length}
                  className="text-[10px] font-mono text-[#00ff41] border border-neutral-700 bg-black/70 px-1.5 py-0.5 hover:bg-[#00ff41] hover:text-black disabled:opacity-35 disabled:pointer-events-none cursor-pointer transition-colors"
                  title="Comando siguiente (Flecha Abajo ↓)"
                  aria-label="Comando siguiente"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isExecuting) {
                      processCommand('history -c');
                      inputRef.current?.focus();
                    }
                  }}
                  disabled={isExecuting}
                  className="text-[10px] font-mono text-[#ff0033] border border-neutral-700 bg-black/70 px-1.5 py-0.5 hover:bg-[#ff0033] hover:text-white disabled:opacity-35 disabled:pointer-events-none cursor-pointer transition-colors"
                  title="Vaciar historial de comandos (history -c)"
                  aria-label="Vaciar historial de comandos"
                >
                  -c
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ====================================================================
          SECUENCIA DE VICTORIA FINAL (WIN SCREEN) + RANGO + QR + LEADERBOARD
          ==================================================================== */}
      {sceneState === 'WIN' &&
        (() => {
          const cleanAlias = hackerAliasInput.trim() || 'Elliot_Alderson';
          const totalTimeStr = formatUptime(elapsedSeconds).replace('UPTIME: ', '');
          const rankInfo = calculateOperatorRank({
            elapsedSeconds,
            failedAttempts: totalFailedAttempts,
            hintsUsed,
            logsCleared,
            debugAuthUsed,
            liveScore: playerScore,
            difficulty,
          });
          const signatureHex = computeVerificationHash(cleanAlias, totalTimeStr, rankInfo.grade);
          const qrPayload = `FSOCIETY_5/9|ALIAS:${cleanAlias}|UPTIME:${totalTimeStr}|FAILS:${totalFailedAttempts}|METAHACK:${debugAuthUsed ? 'YES' : 'NO'}|RANK:${rankInfo.grade}(${rankInfo.score}PTS)|${signatureHex}`;
          const qrMatrix = buildQrMatrix(qrPayload);
          const qrDim = qrMatrix.length;
          const rankTiers: Array<{ grade: OperatorRankGrade; cls: string }> = [
            { grade: 'S+', cls: 's-plus' },
            { grade: 'A', cls: 'a' },
            { grade: 'B', cls: 'b' },
            { grade: 'C', cls: 'c' },
          ];

          return (
            <section className="win-screen-container">
              {monologueNode}
              <h1 className="win-glitch-text" data-text={WIN_VICTORY_TEXT}>
                {WIN_VICTORY_TEXT}
              </h1>

              <div className="win-actions-stack">
                <div className="win-report-panel">
                  <div className="win-telemetry-row">
                    <span>TIEMPO FINAL: {formatUptime(elapsedSeconds)}</span>
                    <span>RANGO: [{rankInfo.grade}] {rankInfo.title}</span>
                    <span>PUNTOS DE CAMPO: {playerScore}</span>
                  </div>

                  {/* Escala Visual de Rangos (S+, A, B, C) y Veredicto de Evaluación */}
                  <div className="win-rank-scale-row">
                    <div className="win-rank-tiers-group">
                      <span className="text-[11px] text-neutral-400 uppercase tracking-wider mr-1">
                        ESCALA DE RANGO:
                      </span>
                      {rankTiers.map((tier) => (
                        <span
                          key={tier.grade}
                          className={`win-rank-tier-chip ${tier.cls} ${
                            rankInfo.grade === tier.grade ? 'active' : ''
                          }`}
                        >
                          {tier.grade}
                        </span>
                      ))}
                    </div>
                    <span className="win-verdict-banner">&ldquo;{rankInfo.verdict}&rdquo;</span>
                  </div>

                  {/* Barra de Calificación Final (S+, A, B, C), Desglose (UPTIME, failedAttempts, Meta-Hacks) y Vista Previa QR Vectorial */}
                  <div className="win-rank-strip">
                    <div className={`win-rank-badge-box ${rankInfo.badgeClass}`}>
                      <span className="win-rank-label">RANGO</span>
                      <span className="win-rank-letter">{rankInfo.grade}</span>
                      <span className="win-rank-score">{rankInfo.score} / 1000 PTS</span>
                    </div>

                    <div className="win-metrics-grid">
                      <div className="win-metric-item">
                        <span className="text-neutral-400">1. UPTIME ({totalTimeStr}):</span>
                        <span className="text-[#00ff41] font-bold">
                          {rankInfo.uptimeDelta >= 0
                            ? `+${rankInfo.uptimeDelta} PTS`
                            : `${rankInfo.uptimeDelta} PTS`}
                        </span>
                      </div>
                      <div className="win-metric-item">
                        <span className="text-neutral-400">2. INTENTOS FALLIDOS:</span>
                        <span
                          className={
                            totalFailedAttempts === 0 ? 'text-[#00ff41] font-bold' : 'text-[#ffbd2e]'
                          }
                        >
                          {totalFailedAttempts} fallos ({rankInfo.failuresPenalty} PTS)
                        </span>
                      </div>
                      <div className="win-metric-item">
                        <span className="text-neutral-400">3. META-HACK (F12):</span>
                        <span
                          className={
                            debugAuthUsed ? 'text-[#38bdf8] font-bold' : 'text-neutral-400'
                          }
                        >
                          {debugAuthUsed ? 'DEBUG_AUTH (+120 PTS)' : 'NO USADO (0 PTS)'}
                        </span>
                      </div>
                      <div className="win-metric-item">
                        <span className="text-neutral-400">4. LOGS (/var/log):</span>
                        <span
                          className={logsCleared ? 'text-[#00ff41] font-bold' : 'text-[#ffbd2e]'}
                        >
                          {logsCleared ? 'GHOST (+130 PTS)' : 'RASTRO ACTIVO'}
                        </span>
                      </div>
                      <div className="win-metric-item">
                        <span className="text-neutral-400">5. PISTAS PEDIDAS:</span>
                        <span className={hintsUsed === 0 ? 'text-[#00ff41]' : 'text-[#ff0033]'}>
                          {hintsUsed} (-{hintsUsed * 100} PTS)
                        </span>
                      </div>
                      <div className="win-metric-item">
                        <span className="text-neutral-400">FIRMA SHA256:</span>
                        <span className="text-neutral-200 text-[10px]" title={signatureHex}>
                          {signatureHex.slice(0, 19)}...
                        </span>
                      </div>
                    </div>

                    <div
                      className="win-qr-preview-box"
                      title={`Código QR Vectorial incluido en fsociety_report.pdf:\n${qrPayload}`}
                    >
                      <svg
                        width="68"
                        height="68"
                        viewBox={`0 0 ${qrDim + 2} ${qrDim + 2}`}
                        className="bg-[#f4f1ea] p-0.5"
                        aria-label="Código QR vectorial de verificación"
                      >
                        {qrMatrix.map((row, rIdx) =>
                          row.map((cell, cIdx) =>
                            cell ? (
                              <rect
                                key={`${rIdx}-${cIdx}`}
                                x={cIdx + 1}
                                y={rIdx + 1}
                                width={1}
                                height={1}
                                fill="#0a0a0c"
                              />
                            ) : null
                          )
                        )}
                      </svg>
                      <span className="win-qr-caption">QR SHA256</span>
                    </div>
                  </div>

                  <div className="win-report-content-grid">
                    <img
                      src={FSOCIETY_REPORT_LOGO_PATH}
                      alt="Emblema de la operación"
                      className="win-report-logo"
                    />

                    <div className="win-report-fields">
                      <label htmlFor="hacker-alias-input" className="win-alias-label">
                        ALIAS DEL OPERADOR (RANKING Y CERTIFICADO PDF):
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="hacker-alias-input"
                          type="text"
                          value={hackerAliasInput}
                          onChange={(e) => setHackerAliasInput(e.target.value)}
                          onKeyDown={(e) => {
                            playTypingSfx();
                            if (e.key === 'Enter') {
                              void generateMissionReportPDF(hackerAliasInput);
                            }
                          }}
                          placeholder="Ej. Elliot_Alderson"
                          className="win-alias-input"
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            playSuccessSfx();
                            upsertLeaderboardRecord(hackerAliasInput);
                          }}
                          className="px-3 py-2 text-xs font-mono font-bold border-2 border-[#00ff41] text-[#00ff41] bg-black hover:bg-[#00ff41] hover:text-black transition-colors cursor-pointer whitespace-nowrap"
                          title="Actualizar tu alias en la Tabla de Clasificación Top 5"
                        >
                          [ GUARDAR EN TOP 5 ]
                        </button>
                      </div>

                      <button
                        id="download-report-btn"
                        type="button"
                        onClick={() => void generateMissionReportPDF(hackerAliasInput)}
                        className="win-report-btn"
                      >
                        [ DESCARGAR INFORME DE MISIÓN (PDF) ]
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tabla de Clasificación Speedrun Top 5 en la pantalla de Victoria */}
                <div id="win-leaderboard" className="speedrun-leaderboard-panel">
                  <div className="leaderboard-header">
                    <span className="leaderboard-title">
                      <Trophy className="w-3.5 h-3.5 text-[#00ff41]" />
                      <span>CLASIFICACIÓN SPEEDRUN · TOP 5 DE ESTE NAVEGADOR</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleResetLeaderboard}
                      className="text-[10px] text-neutral-400 hover:text-[#ff0033] cursor-pointer"
                    >
                      [REINICIAR RANKING]
                    </button>
                  </div>
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th>POS</th>
                        <th>OPERADOR (ALIAS)</th>
                        <th>TIEMPO (UPTIME)</th>
                        <th>RANGO</th>
                        <th>SCORE</th>
                        <th>AUDITORÍA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.slice(0, 5).map((entry, idx) => {
                        const isCurrent = entry.id === currentRunIdRef.current;
                        const pillCls =
                          entry.rank === 'S+'
                            ? 's-plus'
                            : entry.rank === 'A'
                            ? 'a'
                            : entry.rank === 'B'
                            ? 'b'
                            : 'c';
                        return (
                          <tr key={entry.id} className={isCurrent ? 'current-run-row' : ''}>
                            <td className="text-[#00ff41] font-bold">#{idx + 1}</td>
                            <td>
                              {entry.alias} {isCurrent ? ' (TÚ)' : ''}
                            </td>
                            <td>{formatUptime(entry.elapsedSeconds).replace('UPTIME: ', '')}</td>
                            <td>
                              <span className={`rank-pill ${pillCls}`}>{entry.rank}</span>
                            </td>
                            <td>{entry.score} PTS</td>
                            <td className="text-[10px] text-neutral-400">
                              {entry.logsCleared ? '[0% HUELLA] ' : ''}
                              {entry.debugAuthUsed ? '[META-HACK] ' : ''}
                              {entry.failedAttempts === 0 && entry.hintsUsed === 0
                                ? '[FLAWLESS]'
                                : `${entry.failedAttempts}F/${entry.hintsUsed}H`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <button
                  id="restart-system-btn"
                  type="button"
                  onClick={handleResetGameComplete}
                  className="win-restart-btn"
                >
                  [ REINICIAR SISTEMA ]
                </button>
              </div>
            </section>
          );
        })()}

      {/* ====================================================================
          MODAL DE ALIAS HACKER PARA GENERAR EL CERTIFICADO PDF (jsPDF)
          ==================================================================== */}
      {isReportModalOpen && (
        <div
          className="mission-modal-overlay open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
        >
          <div className="mission-modal-box">
            <div className="mission-modal-header">
              <span id="report-modal-title" className="mission-modal-title">
                IDENTIFICACIÓN DE OPERADOR · FSOCIETY
              </span>
            </div>
            <p className="mission-modal-text">
              Introduce tu <strong>Alias Hacker</strong> para expedir el certificado oficial de
              intrusión (<code>fsociety_report.pdf</code>) con tu tiempo final (
              {formatUptime(elapsedSeconds)}).
            </p>
            <div className="mb-5">
              <input
                type="text"
                value={hackerAliasInput}
                onChange={(e) => setHackerAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  playTypingSfx();
                  if (e.key === 'Enter') {
                    generateMissionReportPDF(hackerAliasInput);
                  }
                }}
                placeholder="Ej. Elliot_Alderson"
                className="w-full px-3.5 py-2.5 bg-black border-2 border-[#00ff41] text-[#00ff41] font-mono text-sm focus:outline-none"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsReportModalOpen(false)}
                className="mission-close-btn"
              >
                [ CANCELAR ]
              </button>
              <button
                type="button"
                onClick={() => generateMissionReportPDF(hackerAliasInput)}
                className="terminal-start-btn"
              >
                [ GENERAR PDF ]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          VENTANA MODAL DE INSTRUCCIONES / MISIÓN (#mission-modal)
          ==================================================================== */}
      <div
        id="mission-modal"
        className={`mission-modal-overlay ${isMissionModalOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-modal-title"
      >
        <div className="mission-modal-box">
          <div className="mission-modal-header">
            <span id="mission-modal-title" className="mission-modal-title">
              DIRECTIVA DE OPERACIÓN
            </span>
          </div>
          <div className="mission-modal-text">
            <p>
              <strong>MISIÓN PRINCIPAL:</strong> Infiltrarse en las instalaciones de ECorp,
              vulnerar la cámara acorazada y extraer el pendrive.
            </p>
            <p className="mt-3">
              <strong>FASES DE LA OPERACIÓN:</strong>
            </p>
            <ol className="mission-briefing-list">
              <li>
                <strong>1. Brecha Inicial:</strong> Inyección SQL (SQLi) en el portal web
                corporativo.
              </li>
              <li>
                <strong>2. Movimiento Lateral:</strong> Acceso a la red interna y extracción de
                credenciales (FTP/SMB).
              </li>
              <li>
                <strong>3. Robo de Identidad:</strong> Intercepción y clonado de tarjeta RFID de
                alta seguridad.
              </li>
              <li>
                <strong>4. Objetivo CEO:</strong> Fuerza bruta (SSH) al equipo directivo y
                descifrado Base64 de la clave maestra.
              </li>
              <li>
                <strong>5. Incursión Física:</strong> Ingeniería social (Evil Portal) para
                desactivar alarmas y hackeo de cámaras IP (IoT).
              </li>
              <li>
                <strong>6. Hardware Hacking:</strong> Conexión por puerto serie local a la caja
                fuerte para el volcado final.
              </li>
            </ol>
          </div>
          <button
            id="close-mission-btn"
            type="button"
            onClick={() => setIsMissionModalOpen(false)}
            className="mission-close-btn"
          >
            [ X CERRAR ]
          </button>
        </div>
      </div>

      {/* ====================================================================
          CORTINA DE FUNDIDO A NEGRO
          ==================================================================== */}
      <div
        id="fade-curtain"
        className={sceneState === 'TRANSITIONING' ? 'active' : ''}
        aria-hidden="true"
      />

    </main>
  );
}
