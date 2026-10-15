/* A small tile-map viewer for this application. No third-party mapping library. */
(function (root) {
  'use strict';
  const TILE = 256, MAX_LAT = 85.05112878;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrap = (value, size) => ((value % size) + size) % size;
  function project(lat, lon, zoom) {
    const world = TILE * 2 ** zoom;
    const sin = Math.sin(clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI / 180);
    return {x:(lon + 180) / 360 * world, y:(0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world};
  }
  function unproject(point, zoom) {
    const world = TILE * 2 ** zoom;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / world))) * 180 / Math.PI;
    return [lat, wrap(point.x / world * 360, 360) - 180];
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  class ReportMap {
    constructor(target, options = {}) {
      this.element = typeof target === 'string' ? document.getElementById(target) : target;
      this.minZoom = options.minZoom ?? 3;
      this.maxZoom = options.maxZoom ?? 19;
      this.zoom = options.zoom ?? 5;
      this.center = project(...(options.center || [55,58]), this.zoom);
      this.onTileError = options.onTileError || (() => {});
      this.onTileLoad = options.onTileLoad || (() => {});
      this.tiles = new Map();
      this.markerItems = [];
      this.pointers = new Map();
      this.element.classList.add('report-map');
      this.element.tabIndex = 0;
      this.element.setAttribute('role', 'region');
      this.tileLayer = node('div', 'map-tiles');
      this.tileLayer.setAttribute('aria-hidden', 'true');
      this.markerLayer = node('div', 'map-markers');
      const controls = node('div', 'map-zoom');
      this.zoomIn = node('button', '', '+');
      this.zoomOut = node('button', '', '−');
      this.zoomIn.type = this.zoomOut.type = 'button';
      this.zoomIn.setAttribute('aria-label', 'Увеличить масштаб');
      this.zoomOut.setAttribute('aria-label', 'Уменьшить масштаб');
      this.zoomIn.onclick = () => this.zoomAt(null, this.zoom + 1);
      this.zoomOut.onclick = () => this.zoomAt(null, this.zoom - 1);
      controls.append(this.zoomIn, this.zoomOut);
      const attribution = node('div', 'map-attribution');
      attribution.append(document.createTextNode('© '));
      const credit = node('a', '', 'OpenStreetMap contributors');
      credit.href = 'https://www.openstreetmap.org/copyright';
      credit.target = '_blank';
      credit.rel = 'noopener';
      attribution.append(credit);
      this.element.append(this.tileLayer, this.markerLayer, controls, attribution);
      this._listen();
      this.resizeObserver = new ResizeObserver(() => this.invalidateSize());
      this.resizeObserver.observe(this.element);
      this.render();
    }
    getView() { return {center:unproject(this.center, this.zoom), zoom:this.zoom}; }
    getMarkers() { return this.markerItems.map(item => item.data); }
    setView(center, zoom = this.zoom) {
      this.zoom = clamp(Math.round(zoom), this.minZoom, this.maxZoom);
      this.center = project(center[0], center[1], this.zoom);
      this.render();
      return this;
    }
    invalidateSize() { this.render(); }
    zoomAt(point, zoom) {
      zoom = clamp(Math.round(zoom), this.minZoom, this.maxZoom);
      if (zoom === this.zoom) return;
      const width = this.element.clientWidth, height = this.element.clientHeight;
      point = point || {x:width / 2, y:height / 2};
      const scale = 2 ** (zoom - this.zoom);
      this.center = {x:(this.center.x + point.x - width / 2) * scale - point.x + width / 2,
                     y:(this.center.y + point.y - height / 2) * scale - point.y + height / 2};
      this.zoom = zoom;
      this.render();
    }
    fitPoints(points, options = {}) {
      if (!points.length) return;
      const topLeft = options.paddingTopLeft || [30,30];
      const bottomRight = options.paddingBottomRight || [30,30];
      const availableWidth = Math.max(1, this.element.clientWidth - topLeft[0] - bottomRight[0]);
      const availableHeight = Math.max(1, this.element.clientHeight - topLeft[1] - bottomRight[1]);
      const pixels = points.map(p => project(p[0], p[1], 0));
      const xs = pixels.map(p => p.x), ys = pixels.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const fit = Math.floor(Math.min(Math.log2(availableWidth / Math.max(maxX - minX, 0.001)),
                                      Math.log2(availableHeight / Math.max(maxY - minY, 0.001))));
      this.zoom = clamp(fit, this.minZoom, Math.min(this.maxZoom, options.maxZoom ?? 12));
      const scale = 2 ** this.zoom;
      this.center = {x:(minX + maxX) / 2 * scale + (bottomRight[0] - topLeft[0]) / 2,
                     y:(minY + maxY) / 2 * scale + (bottomRight[1] - topLeft[1]) / 2};
      this.render();
    }
    setMarkers(markers) {
      this.closePopup();
      this.markerLayer.replaceChildren();
      this.markerItems = markers.map(data => {
        const button = node('button', 'map-marker');
        button.type = 'button';
        button.setAttribute('aria-label', data.title || 'Сообщение');
        button.title = data.title || 'Сообщение';
        const dot = node('span', 'pin-dot');
        dot.style.setProperty('--pin-color', data.color);
        button.append(dot);
        if (data.count > 1) button.append(node('span', 'pin-count', String(data.count)));
        button.onclick = event => { event.stopPropagation(); this.openMarker(data.id); };
        this.markerLayer.append(button);
        return {data, element:button};
      });
      this.render();
    }
    openMarker(id) {
      const item = this.markerItems.find(m => m.data.id === id);
      if (!item) return;
      this.closePopup();
      const panel = node('section', 'map-popup');
      panel.setAttribute('aria-label', 'Карточка сообщения');
      const close = node('button', 'map-popup-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Закрыть карточку');
      close.onclick = () => this.closePopup();
      const content = node('div', 'map-popup-content');
      content.append(item.data.popup());
      panel.append(close, content);
      this.element.append(panel);
      this.popup = {item, panel};
      this._positionPopup();
    }
    openMarkerAt(lat, lon) {
      const item = this.markerItems.find(m => m.data.lat === lat && m.data.lon === lon);
      if (item) this.openMarker(item.data.id);
    }
    closePopup() { if (this.popup) { this.popup.panel.remove(); this.popup = null; } }
    _screen(lat, lon) {
      const p = project(lat, lon, this.zoom), world = TILE * 2 ** this.zoom;
      const dx = wrap(p.x - this.center.x + world / 2, world) - world / 2;
      return {x:this.element.clientWidth / 2 + dx, y:this.element.clientHeight / 2 + p.y - this.center.y};
    }
    _positionPopup() {
      if (!this.popup) return;
      const {item, panel} = this.popup;
      const p = this._screen(item.data.lat, item.data.lon);
      const width = this.element.clientWidth, height = this.element.clientHeight;
      panel.hidden = p.x < 0 || p.y < 0 || p.x > width || p.y > height;
      if (panel.hidden) return;
      const left = clamp(p.x - panel.offsetWidth / 2, 12, Math.max(12,width - panel.offsetWidth - 12));
      let top = p.y - panel.offsetHeight - 20;
      if (top < 12) top = p.y + 20;
      top = clamp(top,12,Math.max(12,height - panel.offsetHeight - 12));
      panel.style.transform = `translate3d(${left}px,${top}px,0)`;
    }
    render() {
      const width = this.element.clientWidth, height = this.element.clientHeight;
      if (!width || !height) return;
      const world = TILE * 2 ** this.zoom;
      this.center.y = clamp(this.center.y,0,world);
      const origin = {x:this.center.x - width / 2,y:this.center.y - height / 2};
      const n = 2 ** this.zoom, visible = new Set();
      for (let x = Math.floor(origin.x / TILE); x <= Math.floor((origin.x + width) / TILE); x++) {
        for (let y = Math.max(0,Math.floor(origin.y / TILE)); y <= Math.min(n - 1,Math.floor((origin.y + height) / TILE)); y++) {
          const key = `${this.zoom}/${x}/${y}`;
          visible.add(key);
          let img = this.tiles.get(key);
          if (!img) {
            img = new Image(); img.alt = ''; img.draggable = false;
            img.width = img.height = TILE;
            img.onload = () => this.onTileLoad();
            img.onerror = () => this.onTileError();
            img.src = `https://tile.openstreetmap.org/${this.zoom}/${wrap(x,n)}/${y}.png`;
            this.tiles.set(key,img); this.tileLayer.append(img);
          }
          img.style.transform = `translate3d(${Math.round(x * TILE - origin.x)}px,${Math.round(y * TILE - origin.y)}px,0)`;
        }
      }
      for (const [key,img] of this.tiles) if (!visible.has(key)) { img.remove(); this.tiles.delete(key); }
      for (const item of this.markerItems) {
        const p = this._screen(item.data.lat,item.data.lon);
        item.element.hidden = p.x < -30 || p.y < -30 || p.x > width + 30 || p.y > height + 30;
        item.element.style.transform = `translate3d(${p.x}px,${p.y}px,0) translate(-50%,-50%)`;
      }
      this.zoomIn.disabled = this.zoom === this.maxZoom;
      this.zoomOut.disabled = this.zoom === this.minZoom;
      this._positionPopup();
    }
    _point(event) {
      const rect = this.element.getBoundingClientRect();
      return {x:event.clientX - rect.left,y:event.clientY - rect.top};
    }
    _startGesture() {
      const points = [...this.pointers.values()];
      this.drag = null; this.pinch = null;
      if (points.length >= 2) {
        const a = points[0], b = points[1];
        const mid = {x:(a.x + b.x) / 2,y:(a.y + b.y) / 2};
        this.pinch = {distance:Math.hypot(a.x - b.x,a.y - b.y),zoom:this.zoom,
          anchor:{x:this.center.x + mid.x - this.element.clientWidth / 2,y:this.center.y + mid.y - this.element.clientHeight / 2}};
      } else if (points.length) this.drag = {point:points[0],center:{...this.center},moved:false};
    }
    _listen() {
      this.element.addEventListener('pointerdown', event => {
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('button,a,.map-popup')) return;
        this.pointers.set(event.pointerId,this._point(event));
        this.element.setPointerCapture(event.pointerId);
        this._startGesture();
        this.element.classList.add('dragging');
      });
      this.element.addEventListener('pointermove', event => {
        if (!this.pointers.has(event.pointerId)) return;
        this.pointers.set(event.pointerId,this._point(event));
        const points = [...this.pointers.values()];
        if (this.pinch && points.length >= 2) {
          const a = points[0], b = points[1], start = this.pinch;
          const distance = Math.max(1,Math.hypot(a.x - b.x,a.y - b.y));
          const zoom = clamp(Math.round(start.zoom + Math.log2(distance / Math.max(start.distance,1))),this.minZoom,this.maxZoom);
          const scale = 2 ** (zoom - start.zoom);
          this.zoom = zoom;
          this.center = {x:start.anchor.x * scale - (a.x + b.x) / 2 + this.element.clientWidth / 2,
                         y:start.anchor.y * scale - (a.y + b.y) / 2 + this.element.clientHeight / 2};
        } else if (this.drag) {
          const p = points[0], start = this.drag;
          if (Math.hypot(p.x - start.point.x,p.y - start.point.y) > 3) start.moved = true;
          this.center = {x:start.center.x - p.x + start.point.x,y:start.center.y - p.y + start.point.y};
        }
        if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
      });
      const finish = event => {
        if (!this.pointers.has(event.pointerId)) return;
        if (this.drag && !this.drag.moved && event.type === 'pointerup') this.closePopup();
        this.pointers.delete(event.pointerId);
        if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
        this._startGesture();
        if (!this.pointers.size) this.element.classList.remove('dragging');
      };
      this.element.addEventListener('pointerup',finish);
      this.element.addEventListener('pointercancel',finish);
      this.element.addEventListener('wheel',event => {
        if (event.target.closest('.map-popup')) return;
        event.preventDefault();
        if (Date.now() - (this.lastWheel || 0) < 120) return;
        this.lastWheel = Date.now();
        this.zoomAt(this._point(event),this.zoom + (event.deltaY < 0 ? 1 : -1));
      },{passive:false});
      this.element.addEventListener('dblclick',event => {
        if (event.target.closest('button,a,.map-popup')) return;
        event.preventDefault(); this.zoomAt(this._point(event),this.zoom + 1);
      });
      this.element.addEventListener('keydown',event => {
        if (event.target !== this.element) return;
        const moves = {ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]};
        if (moves[event.key]) { this.center.x += moves[event.key][0]; this.center.y += moves[event.key][1]; this.render(); }
        else if (event.key === '+' || event.key === '=') this.zoomAt(null,this.zoom + 1);
        else if (event.key === '-') this.zoomAt(null,this.zoom - 1);
        else if (event.key === 'Escape') this.closePopup();
        else return;
        event.preventDefault();
      });
    }
  }
  root.ReportMap = ReportMap;
})(globalThis);
