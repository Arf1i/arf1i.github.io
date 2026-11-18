/* Subtle "space dust + nebula" background.
   Deliberately barely visible: it should only be felt in motion. */
(() => {
  "use strict";

  const dustCanvas = document.getElementById("fx-dust");
  const fogCanvas = document.getElementById("fx-fog");
  if (!dustCanvas || !fogCanvas) return;

  const dustCtx = dustCanvas.getContext("2d");
  const fogCtx = fogCanvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const FOG_W = 320; // rendered small, upscaled by the browser -> cheap + soft
  const FOG_H = 320;

  const SPEED = 1.1; // global motion multiplier

  let width = 0;
  let height = 0;
  let dpr = 1;
  let stars = [];

  let time = 0;
  let rafId = 0;
  let lastFrame = 0;

  /* ---------------- dust ---------------- */

  const sprite = (() => {
    const size = 16;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2
    );
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  })();

  function makeStar() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      z: 0.25 + Math.random() * 0.75, // depth -> size, speed, brightness
      alpha: 0.1 + Math.random() * 0.42,
      drift: 2 + Math.random() * 9, // px per second, upward
      sway: 0.3 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.2 + Math.random() * 0.5, // radians per second
    };
  }

  function seedStars() {
    const count = Math.round(
      Math.min(160, Math.max(55, (width * height) / 15000))
    );
    stars = Array.from({ length: count }, makeStar);
  }

  function drawDust() {
    dustCtx.clearRect(0, 0, width, height);

    for (const s of stars) {
      const size = 1.2 + s.z * 3.2;
      const twinkle =
        0.72 + 0.28 * Math.sin(time * s.twinkle * 2 + s.phase * 3);
      dustCtx.globalAlpha = Math.min(0.5, s.alpha * twinkle);
      dustCtx.drawImage(sprite, s.x - size / 2, s.y - size / 2, size, size);
    }

    dustCtx.globalAlpha = 1;
  }

  function stepDust(dt) {
    for (const s of stars) {
      s.y -= s.drift * s.z * dt;
      s.x += Math.sin(time * s.sway + s.phase) * 1.4 * s.z * dt;

      if (s.y < -12) {
        s.y = height + 12;
        s.x = Math.random() * width;
      }
      if (s.x < -12) s.x = width + 12;
      else if (s.x > width + 12) s.x = -12;
    }
  }

  /* ---------------- fog ---------------- */

  const blobs = [
    { c: [88, 96, 214], x: 0.2, y: 0.28, r: 0.62, ax: 0.06, ay: 0.05, px: 0.017, py: 0.021, ph: 0.0 },
    { c: [58, 132, 190], x: 0.78, y: 0.2, r: 0.55, ax: 0.05, ay: 0.07, px: 0.023, py: 0.014, ph: 1.7 },
    { c: [126, 82, 186], x: 0.68, y: 0.78, r: 0.68, ax: 0.07, ay: 0.05, px: 0.013, py: 0.019, ph: 3.1 },
    { c: [64, 104, 168], x: 0.18, y: 0.82, r: 0.52, ax: 0.05, ay: 0.06, px: 0.02, py: 0.016, ph: 4.4 },
  ];

  let parallaxX = 0;
  let parallaxY = 0;
  let targetX = 0;
  let targetY = 0;

  function drawFog() {
    fogCtx.clearRect(0, 0, FOG_W, FOG_H);

    for (const b of blobs) {
      const cx = (b.x + Math.sin(time * b.px + b.ph) * b.ax) * FOG_W + parallaxX;
      const cy = (b.y + Math.cos(time * b.py + b.ph) * b.ay) * FOG_H + parallaxY;
      const r = b.r * FOG_W;
      const grad = fogCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.34)`);
      grad.addColorStop(0.45, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0.1)`);
      grad.addColorStop(1, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},0)`);
      fogCtx.fillStyle = grad;
      fogCtx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  /* ---------------- sizing ---------------- */

  function resize() {
    const prevW = width;
    const prevH = height;

    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    dustCanvas.width = Math.round(width * dpr);
    dustCanvas.height = Math.round(height * dpr);
    dustCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (fogCanvas.width !== FOG_W || fogCanvas.height !== FOG_H) {
      fogCanvas.width = FOG_W;
      fogCanvas.height = FOG_H;
    }

    if (!stars.length) {
      seedStars();
    } else if (prevW && prevH) {
      // keep the same field instead of re-rolling it on every resize
      for (const s of stars) {
        s.x = (s.x / prevW) * width;
        s.y = (s.y / prevH) * height;
      }
    }
  }

  /* ---------------- loop ---------------- */

  function render() {
    drawFog();
    drawDust();
  }

  function frame(now) {
    const dt = Math.min(64, now - lastFrame) / 1000;
    lastFrame = now;
    time += dt * SPEED;

    parallaxX += (targetX - parallaxX) * Math.min(1, dt * 1.6);
    parallaxY += (targetY - parallaxY) * Math.min(1, dt * 1.6);

    stepDust(dt * SPEED);
    render();

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---------------- events ---------------- */

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (!rafId) render();
    }, 150);
  });

  window.addEventListener(
    "pointermove",
    (e) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * -5;
      targetY = (e.clientY / window.innerHeight - 0.5) * -5;
    },
    { passive: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (!reduceMotion.matches) start();
  });

  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) {
      stop();
      render();
    } else {
      start();
    }
  });

  /* ---------------- init ---------------- */

  resize();
  render();

  if (!reduceMotion.matches) start();
})();
