// home-hero.test.js — the banner carousel's gesture maths and the tool rail.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { project, landingIndex, wrapIndex, velocityOf } from './home-hero.js';
import { homeRailTools, launcherTools, TOOLS } from '../data/tools.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const home = readFileSync(`${ROOT}src/html/tab-home.html`, 'utf8');
const css = readFileSync(`${ROOT}src/css/home-hero.css`, 'utf8');

describe('momentum projection', () => {
  it('is zero at rest and keeps the sign of the velocity', () => {
    expect(project(0)).toBe(0);
    expect(project(1000)).toBeGreaterThan(0);
    expect(project(-1000)).toBeLessThan(0);
  });
});

describe('where a mouse drag lands', () => {
  const W = 1000;
  it('a slow drag short of half a slide settles back', () => {
    expect(landingIndex({ pos: 300, v: 0, width: W, from: 0, count: 3 })).toBe(0);
  });
  it('a slow drag past half a slide moves on', () => {
    expect(landingIndex({ pos: 600, v: 0, width: W, from: 0, count: 3 })).toBe(1);
  });
  it('a FLICK moves on even from a short drag — that is the projection', () => {
    expect(landingIndex({ pos: 150, v: 1500, width: W, from: 0, count: 3 })).toBe(1);
    expect(landingIndex({ pos: 1850, v: -1500, width: W, from: 2, count: 3 })).toBe(1);
  });
  it('a hard flick still moves ONE slide, never past it', () => {
    expect(landingIndex({ pos: 200, v: 20000, width: W, from: 0, count: 3 })).toBe(1);
  });
  it('stays inside the slides at both ends', () => {
    expect(landingIndex({ pos: 0, v: -5000, width: W, from: 0, count: 3 })).toBe(0);
    expect(landingIndex({ pos: 2000, v: 5000, width: W, from: 2, count: 3 })).toBe(2);
  });
  it('a zero width (pane hidden) answers the first slide, not NaN', () => {
    expect(landingIndex({ pos: 0, v: 0, width: 0, from: 0, count: 3 })).toBe(0);
  });
});

describe('wrapIndex / velocityOf', () => {
  it('wraps both ways', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(-1, 3)).toBe(2);
  });
  it('velocity is px/s over the kept history', () => {
    expect(velocityOf([{ x: 0, t: 0 }, { x: 50, t: 100 }])).toBe(500);
    expect(velocityOf([{ x: 0, t: 0 }])).toBe(0);
  });
});

describe('the home tool rail', () => {
  const rail = homeRailTools();

  it('leads with the tools the owner named, in that order', () => {
    expect(rail.slice(0, 5).map((t) => t.slug))
      .toEqual(['shop', 'room-booking', 'pr-form', 'projects-view', 'vitalsound']);
  });

  it('is exactly the launcher list, reordered — nothing hidden surfaces, nothing is lost', () => {
    expect(new Set(rail.map((t) => t.slug))).toEqual(new Set(launcherTools().map((t) => t.slug)));
    expect(rail).toHaveLength(launcherTools().length);
  });

  it('ranks are unique, so the order is never a tie broken by accident', () => {
    const ranks = TOOLS.filter((t) => t.home != null).map((t) => t.home);
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks.every(Number.isFinite)).toBe(true);
  });

  it('the website-bug route stays readable on the first screen', () => {
    // It used to be the home quick strip's job, which this rail replaced.
    const vs = rail.find((t) => t.slug === 'vitalsound');
    expect(vs.desc).toContain('เว็บมีปัญหา');
  });

  it('the markup carries no hand-written tile', () => {
    const track = home.match(/id="homeRailTrack"[^>]*>([\s\S]*?)<\/div>/);
    expect(track, 'homeRailTrack not found').toBeTruthy();
    expect(track[1].trim()).toBe('');
  });
});

describe('the banner markup', () => {
  it('has the three slides: welcome, shop, ประกาศ', () => {
    const slides = [...home.matchAll(/class="hero-slide hero-slide--(\w+)"/g)].map((m) => m[1]);
    expect(slides).toEqual(['welcome', 'shop', 'news']);
  });

  it('every slide link opens through the in-app tab handler and keeps a real href', () => {
    const links = [...home.matchAll(/<a class="hero-link" ([^>]*)>/g)].map((m) => m[1]);
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a).toMatch(/href="\/\w+"/);
      expect(a).toMatch(/data-dept-tool-tab="pills-[\w-]+-tab"/);
    }
  });

  it('the autoplay clock and the animation the JS listens for share one name', () => {
    const js = readFileSync(`${ROOT}src/js/home-hero.js`, 'utf8');
    expect(css).toContain('@keyframes hero-progress');
    expect(js).toContain("e.animationName !== 'hero-progress'");
  });

  it('reduced motion turns autoplay off, in CSS and in JS', () => {
    expect(css).toMatch(/\.hero\.is-static \.hero-dot\.is-active \.hero-dot-fill \{ animation: none/);
    const js = readFileSync(`${ROOT}src/js/home-hero.js`, 'utf8');
    expect(js).toContain('prefers-reduced-motion: reduce');
  });
});
