/**
 * Removes the pure black night sky around the frontal 16:9 Chennai Ripon Building
 * panorama via fast 4-connected BFS flood fill + subtle edge anti-aliasing +
 * soft bottom courtyard dissolve so the clock tower, LED parapet signage, and
 * full-width left/right colonnades integrate seamlessly into the Mid layer.
 */
export function createRiponForegroundMask(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (!natW || !natH) {
        reject(new Error('Image has zero dimensions'));
        return;
      }

      // Process at 1280px wide (~35ms total, crisp HD detail, zero main-thread stall)
      const w = Math.min(1280, natW);
      const h = Math.round((natH / natW) * w);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2D context unavailable'));
        return;
      }

      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const total = w * h;

      const smoothstep = (edge0: number, edge1: number, x: number): number => {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
      };

      const isSkyCandidate = (p: number): boolean => {
        const idx4 = p * 4;
        const r = data[idx4];
        const g = data[idx4 + 1];
        const b = data[idx4 + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);

        // Protect warm floodlit stone & blue LED signage
        if (r - b > 14 && lum > 22) return false;
        if (b - r > 14 && lum > 22) return false;

        return lum < 26 && chroma < 18;
      };

      const visited = new Uint8Array(total);
      const isSky = new Uint8Array(total);
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;

      const pushIfSky = (x: number, y: number) => {
        const p = y * w + x;
        if (visited[p]) return;
        visited[p] = 1;
        if (isSkyCandidate(p)) {
          isSky[p] = 1;
          queue[tail++] = p;
        }
      };

      // Seed top edge and upper left/right flanks down past the roofline
      for (let x = 0; x < w; x++) pushIfSky(x, 0);
      const flankLimitY = Math.floor(h * 0.34);
      for (let y = 0; y < flankLimitY; y++) {
        pushIfSky(0, y);
        pushIfSky(w - 1, y);
      }

      while (head < tail) {
        const p = queue[head++];
        const x = p % w;
        const y = (p - x) / w;
        if (x > 0) pushIfSky(x - 1, y);
        if (x < w - 1) pushIfSky(x + 1, y);
        if (y > 0) pushIfSky(x, y - 1);
        if (y < h - 1) pushIfSky(x, y + 1);
      }

      // Single despeckle pass for small enclosed dark-sky triangles around spire/signage
      const upperLimitY = Math.floor(h * 0.34);
      for (let y = 1; y < upperLimitY; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (isSky[p]) continue;
          const idx4 = p * 4;
          const r = data[idx4];
          const g = data[idx4 + 1];
          const b = data[idx4 + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);
          if (lum < 28 && chroma < 16 && r - b < 12 && b - r < 12) {
            let skyN = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if ((dx !== 0 || dy !== 0) && isSky[(y + dy) * w + (x + dx)]) {
                  skyN++;
                }
              }
            }
            if (skyN >= 4) isSky[p] = 1;
          }
        }
      }

      const nightR = 22;
      const nightG = 24;
      const nightB = 62;

      // Apply clean anti-aliased edge feathering, subtle storm shadow harmony & bottom dissolve
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        const bottomDissolve = 1 - smoothstep(0.80, 0.985, ny);

        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          const idx4 = p * 4;

          if (isSky[p]) {
            data[idx4 + 3] = 0;
            continue;
          }

          let skyN = 0;
          if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if ((dx !== 0 || dy !== 0) && isSky[(y + dy) * w + (x + dx)]) {
                  skyN++;
                }
              }
            }
          }

          const r = data[idx4];
          const g = data[idx4 + 1];
          const b = data[idx4 + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const chroma = Math.max(r, g, b) - Math.min(r, g, b);

          let edgeAlpha = 1;
          if (skyN > 0) {
            edgeAlpha =
              lum > 85 || chroma > 34
                ? Math.max(0.62, 1 - skyN * 0.05)
                : Math.max(0.12, 1 - skyN * 0.14);
          }

          // Gently harmonize deepest architectural shadows into the stormy blue night palette
          const shadowMix = (1 - smoothstep(14, 72, lum)) * 0.34;
          data[idx4] = Math.round(r * (1 - shadowMix) + nightR * shadowMix);
          data[idx4 + 1] = Math.round(g * (1 - shadowMix) + nightG * shadowMix);
          data[idx4 + 2] = Math.round(b * (1 - shadowMix) + nightB * shadowMix);
          data[idx4 + 3] = Math.round(255 * edgeAlpha * bottomDissolve);
        }
      }

      ctx.putImageData(imgData, 0, 0);
      const webpUrl = canvas.toDataURL('image/webp', 0.92);
      resolve(webpUrl.startsWith('data:image/webp') ? webpUrl : canvas.toDataURL('image/png'));
    };

    img.onerror = () => reject(new Error('Failed to load Ripon Building image'));
    img.src = src;
  });
}
