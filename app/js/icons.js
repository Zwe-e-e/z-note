/* Z Note · icon set — round-capped pen strokes on a 24px grid */
(function () {
  'use strict';
  const ZN = window.ZN;

  const I = {
    home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
    tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 5-6"/>',
    snip: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8.2 20 18"/><path d="M8.6 15.8 20 6"/>',
    crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
    book: '<path d="M6.5 3.5H17A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6.5z"/><path d="M4 7.5h4M4 12h4M4 16.5h4"/><path d="M11 8.5h4.5"/>',
    note: '<path d="M6.5 3.5h8l4 4v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4"/><path d="M8.5 12h7M8.5 15.5h5"/>',
    todo: '<path d="m4 6.5 1.5 1.5L8 5"/><path d="m4 12.5 1.5 1.5L8 11"/><path d="m4 18.5 1.5 1.5L8 17"/><path d="M11.5 7H20M11.5 13H20M11.5 19H20"/>',
    board: '<rect x="3.5" y="4" width="8" height="7" rx="1"/><rect x="14" y="13.5" width="6.5" height="6.5" rx="1"/><path d="M11.5 7.5H16A1.5 1.5 0 0 1 17.5 9v4.5"/><circle cx="7" cy="16.8" r="2.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="m6.5 7 .8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v5.5M14 11v5.5"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 2-2s-.8-1.5-.8-2.5 1-2 2.3-2H17a3.5 3.5 0 0 0 3.5-3.5c0-3.9-3.8-7-8.5-7z"/><circle cx="8" cy="10.5" r=".9"/><circle cx="11.5" cy="7.5" r=".9"/><circle cx="15.5" cy="8.8" r=".9"/>',
    chevR: '<path d="m9.5 6 6 6-6 6"/>',
    chevD: '<path d="m6 9.5 6 6 6-6"/>',
    chevL: '<path d="m14.5 6-6 6 6 6"/>',
    more: '<circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/>',
    grip: '<circle cx="9" cy="6" r=".9"/><circle cx="15" cy="6" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    tag: '<path d="M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5c4-2 6 2 10.5 0 .9-.4 2-.5 2.5-.3v9.5c-4 2-6-2-10.5 0-.9.4-2 .7-2.5.8"/>',
    undo: '<path d="M8.5 5 4 9.5 8.5 14"/><path d="M4 9.5h10a5.5 5.5 0 0 1 0 11h-3"/>',
    redo: '<path d="M15.5 5 20 9.5 15.5 14"/><path d="M20 9.5H10a5.5 5.5 0 0 0 0 11h3"/>',
    cursor: '<path d="M5.5 3.5 19 10.5l-6 2-2 6z"/>',
    hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 10.5v-6a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v6M17 11V8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-5-2.6l-3.3-4.8a1.5 1.5 0 0 1 2.5-1.7L8 13.5"/>',
    sticky: '<path d="M4.5 4.5h15v9l-6 6h-9z"/><path d="M19.5 13.5h-6v6"/>',
    text: '<path d="M5 6.5v-2h14v2"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
    square: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    diamond: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
    shapes: '<rect x="3.5" y="3.5" width="9.5" height="9.5" rx="1"/><circle cx="15.5" cy="15.5" r="5"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>',
    line: '<path d="M5 19 19 5"/>',
    pen: '<path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="m14.5 6 3 3"/>',
    marker: '<path d="m9 14-3.5 3.5V20h3L12 16.5"/><path d="M8.5 13.5 17 5l3.5 3.5-8.5 8.5z"/><path d="M3.5 21h7"/>',
    eraser: '<path d="M8.5 19.5 3.8 14.8a1.5 1.5 0 0 1 0-2.1l8.4-8.4a1.5 1.5 0 0 1 2.1 0l5.4 5.4a1.5 1.5 0 0 1 0 2.1l-7.2 7.7z"/><path d="m8 8.5 7.5 7.5"/><path d="M8.5 19.5h12"/>',
    frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 3-2.5 5 4"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M10.5 8v5M8 10.5h5"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5"/>',
    fit: '<path d="M4 9V4.5h4.5M20 9V4.5h-4.5M4 15v4.5h4.5M20 15v4.5h-4.5"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
    upload: '<path d="M12 15.5v-11"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 19.5h14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5A1.5 1.5 0 0 1 4.5 14V6A1.5 1.5 0 0 1 6 4.5h8a1.5 1.5 0 0 1 1.5 1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5a8 8 0 0 1-10-10 8 8 0 1 0 10 10z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    inbox: '<path d="M4 13.5 6.5 5h11L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20"/>',
    bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.5.4.8 1 .9 1.7h5.4c.1-.7.4-1.3.9-1.7A6 6 0 0 0 12 3.5z"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V9h4.5"/>',
    folder: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/>',
    move: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M9.5 13.5h5M12.5 11l2.5 2.5-2.5 2.5"/>',
    camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.3"/>',
    timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4l2.5 1.5M9.5 3.5h5"/>',
    clipboard: '<rect x="5.5" y="5" width="13" height="15.5" rx="2"/><path d="M9 6.5V4.2a.7.7 0 0 1 .7-.7h4.6a.7.7 0 0 1 .7.7v2.3z"/>',
    list: '<circle cx="5" cy="7" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17" r="1"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/>',
    olist: '<path d="M4 5.5h1.5V9M4 9h3M4.2 13.8c.6-.9 2.6-.7 2.6.6 0 1-2.6 1.8-2.6 3.1H7"/><path d="M10.5 7H20M10.5 12H20M10.5 17H20"/>',
    quote: '<path d="M5 17.5v-11M9.5 8.5h10M9.5 12.5h10M9.5 16.5h6"/>',
    callout: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".5"/>',
    code: '<path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5M13.5 5l-3 14"/>',
    divider: '<path d="M4 12h16"/><path d="M8 7h8M8 17h8" opacity=".4"/>',
    toggle: '<path d="m5.5 8 4 4-4 4"/><path d="M13 9h7M13 15h7"/>',
    h1: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15.5 10.5 18 8.5V18"/>',
    h2: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15 10.2a2.3 2.3 0 0 1 4.5.6c0 2.2-4.5 4-4.5 7.2h4.7"/>',
    h3: '<path d="M4 6v12M11 6v12M4 12h7"/><path d="M15 9.6a2.2 2.2 0 1 1 2.3 3.1 2.7 2.7 0 1 1-2.7 3"/>',
    para: '<path d="M5 7h14M5 12h14M5 17h9"/>',
    open: '<path d="M13.5 5H19v5.5M19 5l-8 8"/><path d="M17 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7H10"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    cap: '<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5"/><path d="M21.5 9.5V15"/>',
    person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    pin: '<path d="M9 4h6l-1 6 3.5 3.5h-11L10 10z"/><path d="M12 13.5V21"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
    rocket: '<path d="M12 15.5 8.5 12c.5-4 3-7.5 8-8.5 1 .2 1.800 1 2 2-1 5-4.500 7.500-8.500 8z"/><path d="M8.500 12 5 12.500l2-3.500 2.500-.500M12 15.500l-.500 3.500 3.500-2 .500-2.500"/><circle cx="14.500" cy="9.500" r="1.300"/><path d="M6.500 17.500 4.500 19.500"/>',
    layout: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M10 9.5V20"/>',
    data: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.500 6v6c0 1.500 3.400 2.800 7.500 2.800s7.500-1.300 7.500-2.800V6M4.500 12v6c0 1.500 3.400 2.800 7.500 2.800s7.500-1.300 7.500-2.800v-6"/>',
    front: '<rect x="9" y="9" width="11" height="11" rx="1.500" fill="currentColor" fill-opacity=".25"/><path d="M15 9V5.500A1.500 1.500 0 0 0 13.500 4h-8A1.500 1.500 0 0 0 4 5.500v8A1.500 1.500 0 0 0 5.500 15H9"/>',
    back: '<rect x="4" y="4" width="11" height="11" rx="1.500" fill="currentColor" fill-opacity=".25"/><path d="M15 9h3.500A1.500 1.500 0 0 1 20 10.500v8a1.500 1.500 0 0 1-1.500 1.500h-8A1.500 1.500 0 0 1 9 18.500V15"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    page: '<path d="M6.500 3.500h8l4 4v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.500 3.500v4h4"/>',
    info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500"/><circle cx="12" cy="7.800" r=".5"/>',
    keyboard: '<rect x="3" y="6.500" width="18" height="11" rx="2"/><path d="M7 10.500h.01M10.500 10.500h.01M14 10.500h.01M17.500 10.500h.01M8 14h8"/>',
    sync: '<path d="M4.5 11.5a7.5 7.5 0 0 1 13-4.5L19.5 9"/><path d="M19.5 4.5V9H15"/><path d="M19.5 12.5a7.5 7.5 0 0 1-13 4.5L4.5 15"/><path d="M4.5 19.5V15H9"/>',
    dot: '<circle cx="12" cy="12" r="2"/>'
  };

  ZN.icons = I;

  ZN.iconHTML = function (name, size) {
    const s = size || 18;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || I.dot) + '</svg>';
  };

  const tpl = document.createElement('template');
  ZN.icon = function (name, size) {
    tpl.innerHTML = ZN.iconHTML(name, size);
    return tpl.content.firstChild;
  };

  /* the tick drawn inside .chk boxes */
  ZN.tickHTML = '<svg viewBox="0 0 27 27"><path d="M6.500 15.500c1.800 1.400 3.200 3.100 4.300 5.200C13.600 14.200 17.800 9 23.500 5.500"/></svg>';
})();
