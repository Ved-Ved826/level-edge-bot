import React from "react";
import { Buffer } from "node:buffer";

export interface PlotCardData {
  id: number;
  zone: string;
  zoneTitle?: string;
  zoneEmoji?: string;
  title: string;
  ownerLabel: string;
  isFree: boolean;
  basePrice: number;
  forSalePrice: number | null;
  buildingType: string | null;
  buildingName: string | null;
  buildingEmoji?: string | null;
  buildingLevel: number;
  dailyRevenue: number;
  weeklyTax: number;
  isAuction: boolean;
  auctionBid: number;
  hasUnpaidTaxes: boolean;
}

export interface CityMapCardProps {
  guildName?: string;
  treasury: number;
  occupiedCount?: number;
  totalCount?: number;
  plots: PlotCardData[];
}

export const CARD_W = 1200;
export const CARD_H = 840;

type PlotVisualStatus = "free" | "owned" | "built" | "sale" | "auction";

function fmt(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString("ru-RU");
}

function toBase64(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64");
  }
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function clip(text: string, max: number): string {
  const value = (text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function getVisualStatus(plot?: PlotCardData): PlotVisualStatus {
  if (!plot || plot.isFree) {
    if (plot?.isAuction) return "auction";
    return "free";
  }
  if (plot.isAuction) return "auction";
  if (plot.forSalePrice != null && plot.forSalePrice > 0) return "sale";
  if (plot.buildingType && plot.buildingLevel > 0) return "built";
  return "owned";
}

function plotForSlot(plots: PlotCardData[] | undefined, index: number): PlotCardData | undefined {
  if (!plots?.length) return undefined;
  const byId = plots.find((item) => item.id === index + 1);
  return byId ?? plots[index];
}

/* ───────────────────────── Координаты участков под 1200x840 ───────────────────────── */
const PLOT_SLOTS = [
  { x: 480, y: 85, defaultTitle: "Участок #01" },
  { x: 700, y: 85, defaultTitle: "Участок #02" },
  { x: 250, y: 245, defaultTitle: "Участок #03" },
  { x: 480, y: 245, defaultTitle: "Участок #04" },
  { x: 700, y: 245, defaultTitle: "Участок #05" },
  { x: 920, y: 245, defaultTitle: "Участок #06" },
  { x: 250, y: 425, defaultTitle: "Участок #07" },
  { x: 700, y: 425, defaultTitle: "Участок #08" },
  { x: 920, y: 425, defaultTitle: "Участок #09" },
  { x: 250, y: 605, defaultTitle: "Участок #10" },
  { x: 480, y: 605, defaultTitle: "Участок #11" },
  { x: 700, y: 605, defaultTitle: "Участок #12" },
  { x: 920, y: 605, defaultTitle: "Участок #13" },
];

const MINI_GRID: Array<Array<number | "park" | null>> = [
  [null, 0, 1, null],
  [2, 3, 4, 5],
  [6, "park", 7, 8],
  [9, 10, 11, 12],
];

const STATUS_THEME: Record<
  PlotVisualStatus,
  { pad: string; stroke: string; dash: string; badge: string; border: string; ink: string }
> = {
  free: { pad: "#4cae3d", stroke: "#d9f99d", dash: "7 5", badge: "#14532d", border: "#4ade80", ink: "#bbf7d0" },
  owned: { pad: "#3f6f48", stroke: "#86efac", dash: "none", badge: "#0f766e", border: "#5eead4", ink: "#ccfbf1" },
  built: { pad: "#4b5563", stroke: "#e2e8f0", dash: "none", badge: "#1e293b", border: "#93c5fd", ink: "#fde68a" },
  sale: { pad: "#b45309", stroke: "#fde68a", dash: "none", badge: "#78350f", border: "#fbbf24", ink: "#fef08a" },
  auction: { pad: "#9f1239", stroke: "#fda4af", dash: "none", badge: "#7f1d1d", border: "#fb7185", ink: "#fecaca" },
};

/* ───────────────────────── Векторный арт ───────────────────────── */
function emptyPlotSvg(status: PlotVisualStatus): string {
  const forSale = status === "free" || status === "sale" || status === "auction";
  return `
    <rect x="-58" y="28" width="116" height="10" rx="4" fill="#14532d" opacity=".28"/>
    ${
      forSale
        ? `
      <rect x="-4" y="2" width="8" height="26" rx="1" fill="#6d4c41"/>
      <rect x="-28" y="-18" width="56" height="22" rx="5" fill="#fef08a" stroke="#ca8a04" stroke-width="1.6"/>
      <polygon points="0,-12 3,-5 10,-5 4,-1 6,6 0,2 -6,6 -4,-1 -10,-5 -3,-5" fill="#eab308"/>
    `
        : `
      <rect x="-46" y="-8" width="92" height="36" rx="3" fill="#d7ccc8" opacity=".22"/>
      <path d="M-46 -8 H46 M-46 28 H46 M-46 -8 V28 M46 -8 V28" stroke="#ece7dc" stroke-width="1.4" opacity=".55"/>
    `
    }
  `;
}

const BUILDINGS_ART: Record<string, string> = {
  gas: `
    <rect x="-54" y="-8" width="108" height="40" rx="4" fill="#3e4a4f"/>
    <rect x="-54" y="-22" width="108" height="16" rx="3" fill="#e11d48"/>
    <rect x="-54" y="-8" width="108" height="5" fill="#f8fafc"/>
    <rect x="-36" y="0" width="10" height="18" rx="1" fill="#cbd5e1"/>
    <rect x="26" y="0" width="10" height="18" rx="1" fill="#cbd5e1"/>
    <rect x="-14" y="-2" width="12" height="16" rx="2" fill="#fb7185"/>
    <rect x="4" y="-2" width="12" height="16" rx="2" fill="#fb7185"/>
    <circle cx="-30" cy="22" r="5" fill="#111827"/>
    <circle cx="30" cy="22" r="5" fill="#111827"/>
  `,
  shop: `
    <rect x="-50" y="-6" width="78" height="38" rx="3" fill="#e2e8f0"/>
    <rect x="28" y="-18" width="26" height="50" rx="3" fill="#be123c"/>
    <polygon points="-54,-6 30,-6 24,8 -48,8" fill="#e11d48"/>
    <rect x="-42" y="10" width="62" height="12" fill="#67e8f9"/>
    <rect x="-36" y="13" width="12" height="7" fill="#ecfeff"/>
    <rect x="-18" y="13" width="12" height="7" fill="#ecfeff"/>
  `,
  bank: `
    <polygon points="-56,-8 56,-8 0,-36" fill="#f1f5f9"/>
    <rect x="-48" y="-8" width="96" height="40" fill="#cbd5e1"/>
    <rect x="-40" y="-4" width="10" height="28" fill="#ffffff"/>
    <rect x="-20" y="-4" width="10" height="28" fill="#ffffff"/>
    <rect x="10" y="-4" width="10" height="28" fill="#ffffff"/>
    <rect x="30" y="-4" width="10" height="28" fill="#ffffff"/>
    <rect x="-12" y="8" width="24" height="20" fill="#1e3a5f"/>
    <circle cx="0" cy="-18" r="5" fill="#f59e0b"/>
  `,
  casino: `
    <rect x="-52" y="-16" width="104" height="48" rx="8" fill="#2e1064"/>
    <rect x="-52" y="-16" width="104" height="16" rx="8" fill="#6b21a8"/>
    <rect x="-40" y="4" width="80" height="18" rx="3" fill="#4a044e"/>
    <circle cx="-16" cy="13" r="5" fill="#f43f5e"/>
    <circle cx="0" cy="13" r="5" fill="#fbbf24"/>
    <circle cx="16" cy="13" r="5" fill="#22d3ee"/>
    <polygon points="0,-28 -8,-16 8,-16" fill="#fde68a"/>
  `,
  house: `
    <rect x="-40" y="-2" width="80" height="36" rx="3" fill="#fb923c"/>
    <polygon points="-48,-2 48,-2 0,-32" fill="#c2410c"/>
    <rect x="-22" y="8" width="14" height="14" fill="#fde047"/>
    <rect x="8" y="8" width="14" height="14" fill="#fde047"/>
    <rect x="-4" y="10" width="10" height="24" fill="#9a3412"/>
  `,
  mall: `
    <rect x="-54" y="-10" width="64" height="44" rx="3" fill="#cbd5e1"/>
    <rect x="12" y="-26" width="42" height="60" rx="3" fill="#1e3a5f"/>
    <rect x="-46" y="-2" width="20" height="14" fill="#7dd3fc"/>
    <rect x="-22" y="-2" width="20" height="14" fill="#7dd3fc"/>
    <rect x="-46" y="16" width="20" height="10" fill="#38bdf8"/>
    <rect x="-22" y="16" width="20" height="10" fill="#38bdf8"/>
    <rect x="22" y="-14" width="22" height="36" fill="#0ea5e9" opacity=".85"/>
  `,
  pizza: `
    <rect x="-48" y="-8" width="96" height="42" rx="6" fill="#ea580c"/>
    <polygon points="-48,-2 48,-2 40,10 -40,10" fill="#dc2626"/>
    <circle cx="0" cy="-22" r="12" fill="#facc15"/>
    <circle cx="-4" cy="-24" r="2" fill="#ef4444"/>
    <circle cx="5" cy="-20" r="2" fill="#16a34a"/>
    <rect x="-16" y="12" width="32" height="12" rx="2" fill="#fff7ed"/>
  `,
  port: `
    <rect x="-54" y="10" width="108" height="18" rx="2" fill="#64748b"/>
    <rect x="-48" y="-10" width="70" height="28" fill="#cbd5e1"/>
    <path d="M28 28 V-28 h-8 l-14 12" fill="none" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/>
    <rect x="-40" y="-2" width="16" height="10" fill="#38bdf8"/>
    <rect x="-18" y="-2" width="16" height="10" fill="#38bdf8"/>
  `,
  mine: `
    <path d="M-48 24 Q-58 -12 -28 -28 Q0 -38 28 -28 Q58 -12 48 24 Z" fill="#57534e"/>
    <path d="M-16 24 V-2 Q0 -14 16 -2 V24 Z" fill="#0f172a"/>
    <path d="M-20 24 V-4 Q0 -18 20 -4 V24" fill="none" stroke="#b45309" stroke-width="4"/>
    <rect x="-8" y="8" width="16" height="10" fill="#fbbf24"/>
  `,
  farm: `
    <rect x="-48" y="6" width="52" height="24" rx="2" fill="#dc2626"/>
    <polygon points="-54,6 10,6 -22,-22" fill="#f8fafc"/>
    <rect x="16" y="-20" width="16" height="36" rx="2" fill="#94a3b8"/>
    <rect x="10" y="10" width="38" height="16" fill="#a16207"/>
    <rect x="-40" y="12" width="10" height="10" fill="#7f1d1d"/>
  `,
};

function getBuildingShape(kind: string | null): string {
  if (!kind) return BUILDINGS_ART.house;
  const k = kind.toLowerCase();
  if (k.includes("mine") || k.includes("шахт")) return BUILDINGS_ART.mine;
  if (k.includes("farm") || k.includes("ферм")) return BUILDINGS_ART.farm;
  if (k.includes("bank") || k.includes("банк")) return BUILDINGS_ART.bank;
  if (k.includes("gas") || k.includes("азс")) return BUILDINGS_ART.gas;
  if (k.includes("casino") || k.includes("казино")) return BUILDINGS_ART.casino;
  if (k.includes("pizza") || k.includes("пицц")) return BUILDINGS_ART.pizza;
  if (k.includes("mall") || k.includes("центр") || k.includes("тц")) return BUILDINGS_ART.mall;
  if (k.includes("port") || k.includes("порт")) return BUILDINGS_ART.port;
  if (k.includes("house") || k.includes("дом")) return BUILDINGS_ART.house;
  return BUILDINGS_ART.shop;
}

function plotCellSvg(slot: (typeof PLOT_SLOTS)[number], index: number, plot?: PlotCardData): string {
  const status = getVisualStatus(plot);
  const theme = STATUS_THEME[status];
  const isBuilt = Boolean(plot && !plot.isFree && plot.buildingType && plot.buildingLevel > 0);
  const content = isBuilt ? getBuildingShape(plot?.buildingType || null) : emptyPlotSvg(status);
  const n = String(plot?.id ?? index + 1).padStart(2, "0");
  const tax = plot?.hasUnpaidTaxes
    ? `<g transform="translate(48 -28)">
         <circle r="11" fill="#881337" stroke="#fecdd3" stroke-width="2"/>
         <text x="0" y="4" text-anchor="middle" font-size="13" font-weight="900" fill="#fff" font-family="sans-serif">!</text>
       </g>`
    : "";

  return `
    <g transform="translate(${slot.x} ${slot.y + 12})">
      <ellipse cx="0" cy="40" rx="62" ry="10" fill="#14532d" opacity=".22"/>
      <rect x="-62" y="-34" width="124" height="78" rx="12" fill="${theme.pad}" stroke="${theme.stroke}" stroke-width="2.6" stroke-dasharray="${theme.dash}"/>
      ${content}
      <rect x="-18" y="26" width="36" height="14" rx="7" fill="#0b1220" opacity=".82"/>
      <text x="0" y="37" text-anchor="middle" font-size="10" font-weight="800" fill="#f8fafc" font-family="sans-serif">${n}</text>
      ${tax}
    </g>
  `;
}

/* ───────────────────────── Фоновая карта (SVG) ───────────────────────── */
function createIslandMapSvg(plots: PlotCardData[]): string {
  const w = CARD_W;
  const h = CARD_H;
  const cellsSvg = PLOT_SLOTS.map((slot, index) => plotCellSvg(slot, index, plotForSlot(plots, index))).join("\n");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <radialGradient id="waterGrad" cx="68%" cy="78%" r="92%">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="42%" stop-color="#0284c7"/>
          <stop offset="100%" stop-color="#0c4a6e"/>
        </radialGradient>
        <linearGradient id="grassGrad" x1="0%" y1="0%" x2="18%" y2="100%">
          <stop offset="0%" stop-color="#4ade80"/>
          <stop offset="55%" stop-color="#22c55e"/>
          <stop offset="100%" stop-color="#15803d"/>
        </linearGradient>
        <linearGradient id="goldLine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#fde68a" stop-opacity="0"/>
          <stop offset="50%" stop-color="#fbbf24"/>
          <stop offset="100%" stop-color="#fde68a" stop-opacity="0"/>
        </linearGradient>
        <g id="pine">
          <ellipse cx="2" cy="4" rx="14" ry="5" fill="#143b22" opacity=".28"/>
          <rect x="-2" y="-2" width="4" height="6" fill="#54371f"/>
          <polygon points="-15,0 0,-18 15,0" fill="#1f6932"/>
          <polygon points="-12,-11 0,-27 12,-11" fill="#257a3b"/>
          <polygon points="-9,-21 0,-35 9,-21" fill="#4ade80"/>
        </g>
        <g id="roundTree">
          <ellipse cx="2" cy="4" rx="13" ry="5" fill="#143b22" opacity=".28"/>
          <rect x="-2" y="-3" width="4" height="7" rx="1" fill="#5a3d24"/>
          <circle cx="-5" cy="-14" r="8" fill="#166534"/>
          <circle cx="5" cy="-14" r="8" fill="#15803d"/>
          <circle cx="0" cy="-21" r="10" fill="#22c55e"/>
        </g>
      </defs>

      <rect width="${w}" height="${h}" fill="url(#waterGrad)"/>
      <path d="M40 180 Q180 150 320 190 T620 170 T980 210 T1180 250" fill="none" stroke="#7dd3fc" stroke-width="10" opacity=".16"/>
      <path d="M20 430 Q220 400 420 450 T860 420 T1180 490" fill="none" stroke="#e0f2fe" stroke-width="7" opacity=".10"/>

      <path d="
        M0,0 L1200,0 L1200,60
        Q1140,110 1130,220
        Q1145,360 1100,450
        Q1060,540 1110,640
        Q1110,710 1020,730
        Q940,750 910,810
        Q830,810 790,830
        L635,840 L545,840
        Q410,840 370,800
        Q270,810 210,840
        L0,840 Z" fill="#fde68a"/>
      <path d="
        M0,0 L1200,0 L1200,50
        Q1130,100 1120,210
        Q1135,350 1090,440
        Q1050,530 1100,630
        Q1100,700 1010,720
        Q930,740 900,800
        Q820,800 780,820
        L635,840 L545,840
        Q410,830 370,790
        Q270,800 210,830
        L0,830 Z" fill="#67e8f9" opacity=".42"/>
      <path d="
        M0,0 L1200,0 L1200,35
        Q1115,90 1105,200
        Q1120,340 1075,430
        Q1035,520 1085,620
        Q1085,680 995,705
        Q915,725 885,785
        Q805,785 765,805
        L630,840 L550,840
        Q400,810 360,770
        Q260,780 200,810
        L0,810 Z" fill="url(#grassGrad)"/>

      <polygon points="80,140 170,25 250,140" fill="#94a3b8"/>
      <polygon points="170,25 250,140 215,140" fill="#64748b"/>
      <polygon points="170,25 145,65 160,60 170,72 185,58 198,65" fill="#f8fafc"/>
      <polygon points="190,135 260,35 320,135" fill="#cbd5e1"/>
      <polygon points="260,35 320,135 285,135" fill="#64748b"/>
      <polygon points="260,35 240,65 252,60 262,70 275,60 286,65" fill="#f8fafc"/>
      <path d="M255 60 Q270 95 265 115" fill="none" stroke="#38bdf8" stroke-width="10" stroke-linecap="round"/>
      <path d="M256 60 Q271 95 266 115" fill="none" stroke="#e0f2fe" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="260" cy="140" rx="35" ry="18" fill="#0369a1"/>
      <ellipse cx="260" cy="140" rx="28" ry="14" fill="#38bdf8"/>

      <path d="M940 50 Q1120 20 1090 150 Q1040 190 930 150 Q880 110 940 50 Z" fill="#0369a1"/>
      <path d="M950 58 Q1105 32 1080 142 Q1030 178 940 142 Q895 105 950 58 Z" fill="#38bdf8"/>
      <g transform="translate(1015 105) rotate(24)">
        <ellipse cx="0" cy="0" rx="14" ry="6" fill="#7c2d12"/>
        <ellipse cx="0" cy="0" rx="11" ry="4" fill="#fed7aa"/>
      </g>

      <g fill="none" stroke="#1e293b" stroke-linecap="round" stroke-linejoin="round" stroke-width="46">
        <path d="M 160,165 L 1020,165 M 160,345 L 1020,345 M 160,525 L 1020,525 M 160,705 L 1020,705 M 370,165 L 370,705 M 590,75 L 590,840 M 810,165 L 810,705 M 160,165 Q 130,165 130,195 L 130,675 Q 130,705 160,705"/>
      </g>
      <g fill="none" stroke="#475569" stroke-linecap="round" stroke-linejoin="round" stroke-width="34">
        <path d="M 160,165 L 1020,165 M 160,345 L 1020,345 M 160,525 L 1020,525 M 160,705 L 1020,705 M 370,165 L 370,705 M 590,75 L 590,840 M 810,165 L 810,705 M 160,165 Q 130,165 130,195 L 130,675 Q 130,705 160,705"/>
      </g>
      <g fill="none" stroke="#f8fafc" stroke-width="2.4" stroke-dasharray="14 12" stroke-linecap="round" opacity=".88">
        <path d="
          M 170,165 L 340,165 M 400,165 L 560,165 M 620,165 L 780,165 M 840,165 L 1000,165
          M 170,345 L 340,345 M 400,345 L 560,345 M 620,345 L 780,345 M 840,345 L 1000,345
          M 170,525 L 340,525 M 400,525 L 560,525 M 620,525 L 780,525 M 840,525 L 1000,525
          M 170,705 L 340,705 M 400,705 L 560,705 M 620,705 L 780,705 M 840,705 L 1000,705
          M 370,185 L 370,325 M 370,365 L 370,505 M 370,545 L 370,685
          M 590,95 L 590,145 M 590,185 L 590,325 M 590,365 L 590,505 M 590,545 L 590,685 M 590,725 L 590,830
          M 810,185 L 810,325 M 810,365 L 810,505 M 810,545 L 810,685
        "/>
      </g>

      <rect x="555" y="745" width="70" height="35" fill="#64748b" rx="2"/>
      <rect x="551" y="740" width="8" height="45" fill="#cbd5e1"/>
      <rect x="621" y="740" width="8" height="45" fill="#cbd5e1"/>

      <g transform="translate(480 425)">
        <rect x="-70" y="-60" width="140" height="120" rx="14" fill="#4ade80" stroke="#166534" stroke-width="3"/>
        <circle cx="0" cy="0" r="40" fill="#e7e5e4"/>
        <rect x="-5" y="-56" width="10" height="112" fill="#d6d3d1"/>
        <rect x="-66" y="-5" width="132" height="10" fill="#d6d3d1"/>
        <circle cx="0" cy="0" r="26" fill="#a8a29e"/>
        <circle cx="0" cy="0" r="16" fill="#0284c7" stroke="#f8fafc" stroke-width="3"/>
        <circle cx="0" cy="0" r="8" fill="#7dd3fc"/>
        <circle cx="0" cy="0" r="3" fill="#ffffff"/>
        <use href="#roundTree" x="-50" y="-38"/>
        <use href="#roundTree" x="50" y="-38"/>
        <use href="#roundTree" x="-50" y="38"/>
        <use href="#roundTree" x="50" y="38"/>
      </g>

      ${cellsSvg}

      <use href="#pine" x="40" y="70"/>
      <use href="#pine" x="65" y="120"/>
      <use href="#roundTree" x="50" y="190"/>
      <use href="#pine" x="40" y="420"/>
      <use href="#roundTree" x="50" y="520"/>
      <use href="#pine" x="40" y="640"/>
      <use href="#pine" x="390" y="45"/>
      <use href="#roundTree" x="780" y="50"/>
      <use href="#pine" x="1110" y="270"/>
      <use href="#roundTree" x="1080" y="500"/>
      <use href="#pine" x="1020" y="640"/>

      <g transform="translate(62 62)">
        <circle cx="0" cy="0" r="38" fill="#0f172a" stroke="#fbbf24" stroke-width="3"/>
        <circle cx="0" cy="0" r="31" fill="#14532d"/>
        <polygon points="0,-26 6,-4 0,0 -6,-4" fill="#f8fafc"/>
        <polygon points="0,26 6,4 0,0 -6,4" fill="#86efac"/>
        <polygon points="-26,0 -4,-6 0,0 -4,6" fill="#f8fafc"/>
        <polygon points="26,0 4,-6 0,0 4,6" fill="#86efac"/>
        <circle cx="0" cy="0" r="4" fill="#fbbf24"/>
        <text x="0" y="-30" fill="#fde68a" font-size="11" font-weight="900" text-anchor="middle" font-family="sans-serif">N</text>
        <text x="0" y="40" fill="#f8fafc" font-size="10" font-weight="800" text-anchor="middle" font-family="sans-serif">S</text>
        <text x="-34" y="4" fill="#f8fafc" font-size="10" font-weight="800" text-anchor="middle" font-family="sans-serif">W</text>
        <text x="34" y="4" fill="#f8fafc" font-size="10" font-weight="800" text-anchor="middle" font-family="sans-serif">E</text>
      </g>
      <rect x="0" y="0" width="${w}" height="6" fill="url(#goldLine)"/>
    </svg>
  `;
}

function hudPanel(extra: React.CSSProperties): React.CSSProperties {
  return {
    display: "flex",
    backgroundColor: "rgba(7, 15, 25, 0.90)",
    border: "1.5px solid rgba(251, 191, 36, 0.55)",
    borderRadius: 14,
    ...extra,
  };
}

function CityHeader({ guildName }: { guildName?: string }): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: 108,
        top: 14,
        width: 260,
        flexDirection: "column",
        padding: "8px 12px",
        ...hudPanel({}),
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#fbbf24" }}>
        РЫНОК БИЗНЕС-ИМПЕРИЙ
      </span>
      <span style={{ fontSize: 16, fontWeight: 900, color: "#f8fafc", lineHeight: 1.15, marginTop: 1 }}>
        {clip(guildName || "Город сервера", 22)}
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginTop: 2 }}>
        Земли под компании · владей и строй
      </span>
    </div>
  );
}

function MiniOccupancy({ plots }: { plots: PlotCardData[] }): React.ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {MINI_GRID.map((row, r) => (
        <div key={r} style={{ display: "flex", gap: 3, justifyContent: "center" }}>
          {row.map((cell, c) => {
            if (cell === null) {
              return <div key={c} style={{ display: "flex", width: 17, height: 11 }} />;
            }
            if (cell === "park") {
              return (
                <div
                  key={c}
                  style={{
                    display: "flex",
                    width: 17,
                    height: 11,
                    borderRadius: 3,
                    backgroundColor: "#14532d",
                    border: "1px solid #4ade80",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width={7} height={7} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path d="M12 2l8 10-8 10L4 12z" fill="#bbf7d0" />
                  </svg>
                </div>
              );
            }
            const plot = plotForSlot(plots, cell);
            const status = getVisualStatus(plot);
            const color =
              status === "free"
                ? "#22c55e"
                : status === "auction"
                  ? "#f43f5e"
                  : status === "sale"
                    ? "#f59e0b"
                    : status === "built"
                      ? "#38bdf8"
                      : "#2dd4bf";
            return (
              <div
                key={c}
                style={{
                  display: "flex",
                  width: 17,
                  height: 11,
                  borderRadius: 3,
                  backgroundColor: color,
                  opacity: plot?.hasUnpaidTaxes ? 0.7 : 1,
                  border: plot?.hasUnpaidTaxes ? "1px solid #fecaca" : "1px solid rgba(255,255,255,0.2)",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function OccupancyHud({
  plots,
  occupied,
  total,
  free,
  forSale,
  auctions,
  income,
  taxAlerts,
}: {
  plots: PlotCardData[];
  occupied: number;
  total: number;
  free: number;
  forSale: number;
  auctions: number;
  income: number;
  taxAlerts: number;
}): React.ReactElement {
  const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const barW = 156;
  const fillW = Math.max(4, Math.round((barW * Math.min(pct, 100)) / 100));
  const fillColor = pct >= 90 ? "#f43f5e" : pct >= 70 ? "#f59e0b" : "#22c55e";

  const chips = [
    { label: "Свободно", value: free, color: "#86efac" },
    { label: "Продажа", value: forSale, color: "#fde68a" },
    { label: "Аукцион", value: auctions, color: "#fda4af" },
  ];

  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        right: 14,
        top: 14,
        width: 184,
        flexDirection: "column",
        padding: "10px 12px",
        gap: 6,
        ...hudPanel({}),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.1, color: "#fbbf24" }}>ЗАПОЛНЕННОСТЬ</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: "#ffffff" }}>{pct}%</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontSize: 18, fontWeight: 900, color: "#ffffff" }}>{occupied}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>/ {total} мест занято</span>
      </div>

      <div
        style={{
          display: "flex",
          width: barW,
          height: 6,
          borderRadius: 99,
          backgroundColor: "#1e293b",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", width: fillW, height: 6, backgroundColor: fillColor }} />
      </div>

      <MiniOccupancy plots={plots} />

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        {chips.map((chip) => (
          <div key={chip.label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: chip.color }}>{chip.value}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8" }}>{chip.label}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 5,
          borderTop: "1px solid rgba(148,163,184,0.22)",
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8" }}>Доход сети</span>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#fde68a" }}>+{fmt(income)}/сут</span>
      </div>
      {taxAlerts > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <IconWarning />
          <span style={{ fontSize: 9, fontWeight: 800, color: "#fda4af" }}>Долги по налогам: {taxAlerts}</span>
        </div>
      ) : null}
    </div>
  );
}

function MapLegend(): React.ReactElement {
  const items = [
    { label: "Свободно", color: "#22c55e" },
    { label: "Компания", color: "#38bdf8" },
    { label: "Продажа", color: "#f59e0b" },
    { label: "Аукцион", color: "#f43f5e" },
    { label: "Налог", color: "#fb7185" },
  ];

  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: 14,
        bottom: 14,
        padding: "7px 11px",
        gap: 9,
        alignItems: "center",
        ...hudPanel({ borderRadius: 12 }),
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ display: "flex", width: 9, height: 9, borderRadius: 99, backgroundColor: it.color }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: "#f8fafc" }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function CoinBalance({ treasury }: { treasury: number }): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        right: 14,
        bottom: 14,
        alignItems: "center",
        gap: 9,
        padding: "6px 12px",
        ...hudPanel({ borderRadius: 12 }),
      }}
    >
      <div
        style={{
          display: "flex",
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: "#f59e0b",
          border: "2px solid #fef08a",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <circle cx={12} cy={12} r={9} fill="none" stroke="#fef08a" strokeWidth={2.5} />
          <rect x={10.9} y={6} width={2.2} height={12} rx={1.1} fill="#fef08a" />
        </svg>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#94a3b8" }}>Казна города</span>
        <span style={{ fontSize: 14, fontWeight: 900, color: "#ffffff" }}>{fmt(treasury)}</span>
      </div>
    </div>
  );
}

/* ──────────────── Векторные иконки ────────────────
   Шрифт Inter не содержит эмодзи — Satori рисует вместо них «тофу».
   Поэтому все значки в текстовых узлах — inline SVG (path/rect/circle). */

function IconBuilding({ color }: { color: string }): React.ReactElement {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x={4} y={3} width={10} height={18} rx={1.5} fill={color} />
      <rect x={15} y={11} width={5} height={10} rx={1} fill={color} />
    </svg>
  );
}

function IconHouse({ color }: { color: string }): React.ReactElement {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3L2.5 11h2.5v9h6v-6h2v6h6v-9h2.5L12 3z" fill={color} />
    </svg>
  );
}

function IconPin({ color, dot }: { color: string; dot: string }): React.ReactElement {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 2a7 7 0 0 0-7 7c0 4.9 5.7 11.2 6.3 11.9a1 1 0 0 0 1.4 0C13.3 20.2 19 13.9 19 9a7 7 0 0 0-7-7z" fill={color} />
      <circle cx={12} cy={9} r={2.4} fill={dot} />
    </svg>
  );
}

function IconWarning(): React.ReactElement {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3l10 18H2L12 3z" fill="#fda4af" />
      <rect x={11} y={9.5} width={2} height={6} rx={1} fill="#4c0519" />
      <circle cx={12} cy={18} r={1.2} fill="#4c0519" />
    </svg>
  );
}

function BuildingBadge({
  x,
  y,
  slot,
  plot,
}: {
  x: number;
  y: number;
  slot: (typeof PLOT_SLOTS)[number];
  plot?: PlotCardData;
}): React.ReactElement {
  const status = getVisualStatus(plot);
  const theme = STATUS_THEME[status];
  const isBuilt = Boolean(plot && !plot.isFree && plot.buildingType && plot.buildingLevel > 0);
  const id = String(plot?.id ?? 0).padStart(2, "0");

  let title: string;
  if (isBuilt) {
    title = plot?.buildingName || "Компания";
  } else if (status === "owned") {
    title = plot?.title || `Участок #${id}`;
  } else {
    title = plot ? `Участок #${id}` : slot.defaultTitle;
  }

  const icon = isBuilt ? (
    <IconBuilding color={theme.border} />
  ) : status === "owned" ? (
    <IconHouse color={theme.border} />
  ) : (
    <IconPin color={theme.border} dot="#0a1220" />
  );

  let statusText: string;
  if (status === "auction") statusText = `Аукцион · ${fmt(plot?.auctionBid ?? 0)}`;
  else if (status === "sale") statusText = `${fmt(plot?.forSalePrice ?? 0)}`;
  else if (status === "free") statusText = `${fmt(plot?.basePrice ?? 2500)}`;
  else if (isBuilt) statusText = `Ур.${plot?.buildingLevel ?? 1} · +${fmt(plot?.dailyRevenue ?? 0)}`;
  else statusText = "Ждёт стройку";

  const owner =
    plot && !plot.isFree && plot.ownerLabel && plot.ownerLabel !== "—"
      ? clip(plot.ownerLabel, 12)
      : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: x - 64,
        top: y - 56, // Поднят выше центра участка: теперь само место свободно для просмотра
        width: 128,
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          backgroundColor: "rgba(10, 18, 30, 0.92)",
          border: `1.5px solid ${theme.border}`,
          borderRadius: 8,
          padding: "2px 6px 3px 6px",
          boxShadow: "0 3px 10px rgba(0,0,0,0.45)",
          maxWidth: 128,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          {icon}
          <span style={{ fontSize: 10, fontWeight: 900, color: "#ffffff", whiteSpace: "nowrap" }}>
            {clip(title, 13)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 3, marginTop: 1 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: theme.ink, whiteSpace: "nowrap" }}>
            {statusText}
          </span>
          {owner ? (
            <span style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8", whiteSpace: "nowrap" }}>
              · {owner}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const CityMapCard = ({
  guildName,
  treasury,
  occupiedCount,
  totalCount,
  plots,
}: CityMapCardProps) => {
  const list = plots || [];
  const total = totalCount ?? Math.max(PLOT_SLOTS.length, list.length);
  const occupied = occupiedCount ?? list.filter((p) => !p.isFree).length;
  const free = list.filter((p) => p.isFree).length;
  const forSale = list.filter((p) => p.forSalePrice != null && p.forSalePrice > 0).length;
  const auctions = list.filter((p) => p.isAuction).length;
  const income = list.reduce((sum, p) => sum + (p.isFree ? 0 : p.dailyRevenue || 0), 0);
  const taxAlerts = list.filter((p) => p.hasUnpaidTaxes).length;
  const mapSvg = createIslandMapSvg(list);
  const mapSrc = `data:image/svg+xml;base64,${toBase64(mapSvg)}`;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: CARD_W,
        height: CARD_H,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: "#0c4a6e",
        fontFamily: "'Nunito', 'Inter', system-ui, sans-serif",
      }}
    >
      <img src={mapSrc} width={CARD_W} height={CARD_H} style={{ position: "absolute", left: 0, top: 0 }} alt="Map" />

      {PLOT_SLOTS.map((slot, index) => (
        <BuildingBadge key={plotForSlot(list, index)?.id ?? index} x={slot.x} y={slot.y} slot={slot} plot={plotForSlot(list, index)} />
      ))}

      <CityHeader guildName={guildName} />
      <OccupancyHud
        plots={list}
        occupied={occupied}
        total={total}
        free={free}
        forSale={forSale}
        auctions={auctions}
        income={income}
        taxAlerts={taxAlerts}
      />
      <MapLegend />
      <CoinBalance treasury={treasury} />
    </div>
  );
};