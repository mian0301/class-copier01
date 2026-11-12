// ============================================================
// 类名复制器 v1.8 - SillyTavern 第三方扩展
//
// 两层开关：
//   1. 总开关（魔棒菜单项）：关闭时整个插件"消失"
//   2. 选取模式（悬浮按钮）：总开关打开后才有意义
//
// 选取模式行为：
//   单击任意元素 → 选中该元素，并出现选择框把它框起来
//   双击任意元素 → 放行给酒馆/插件的原本点击逻辑
//
// 悬浮按钮下方（选取模式开启时出现）：
//   [✕ 取消] → 取消选取：清除选择框并退出选取模式
//   [复制]   → 复制当前选中元素的 id / class（CSS 选择器格式），并弹出提示
//
// 豁免区（选取模式下单击直接放行，不选取）：
//   - 悬浮面板自身
//   - 本插件自己的菜单项（"类名复制器：开/关"）
// ============================================================
(function () {
    const PANEL_ID     = 'cc-class-copier';
    const POS_KEY      = 'cc-copier-pos';
    const MENU_ITEM_ID = 'cc-copier-menu-item';
    const SELBOX_ID    = 'cc-select-box';

    const DBLCLICK_MS   = 220;
    const DBLCLICK_DIST = 6;

    if (document.getElementById(PANEL_ID)) return;

    // ---------- 样式 ----------
    const style = document.createElement('style');
    style.textContent = `
    #${PANEL_ID} {
        position: fixed;
        right: 12px;
        top: 70px;
        z-index: 2147483647;
        font-size: 13px;
        user-select: none;
    }
    #${PANEL_ID} .cc-btn {
        background: rgba(28,28,38,.92);
        color: #fff;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 10px;
        padding: 8px 14px;
        cursor: grab;
        box-shadow: 0 4px 12px rgba(0,0,0,.4);
        backdrop-filter: blur(6px);
        font-family: inherit;
        transition: background .15s;
        touch-action: none;
    }
    #${PANEL_ID}.dragging .cc-btn { cursor: grabbing; }
    #${PANEL_ID}.on .cc-btn { background: rgba(46,139,87,.95); }

    /* 悬浮按钮下方的两个小按钮：仅选取模式下显示 */
    #${PANEL_ID} .cc-sub-row {
        display: none;
        margin-top: 6px;
        gap: 6px;
        justify-content: center;
    }
    #${PANEL_ID}.on .cc-sub-row { display: flex; }
    #${PANEL_ID} .cc-sub {
        flex: 1;
        color: #fff;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 8px;
        padding: 4px 8px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        box-shadow: 0 3px 8px rgba(0,0,0,.4);
        white-space: nowrap;
    }
    #${PANEL_ID} .cc-cancel { background: rgba(200,60,60,.95); }
    #${PANEL_ID} .cc-copy   { background: rgba(46,139,87,.95); }

    #${PANEL_ID} .cc-toast {
        margin-top: 8px;
        background: rgba(18,18,26,.95);
        color: #9fe6b0;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 8px;
        padding: 8px 10px;
        max-width: 340px;
        word-break: break-all;
        display: none;
        box-shadow: 0 4px 12px rgba(0,0,0,.4);
    }
    .cc-highlight {
        outline: 2px dashed #4caf50 !important;
        outline-offset: -2px;
    }
    /* 选中元素的选择框 */
    #${SELBOX_ID} {
        position: fixed;
        display: none;
        pointer-events: none;
        z-index: 2147483646;
        box-sizing: border-box;
        border: 2px solid #ff9f1a;
        background: rgba(255,159,26,.15);
        border-radius: 2px;
    }
    #${MENU_ITEM_ID}.cc-menu-on {
        color: #7fd18f;
    }
    #${MENU_ITEM_ID}.cc-menu-on .extensionsMenuExtensionButton {
        color: #7fd18f;
    }`;
    document.head.appendChild(style);

    // ---------- 面板 ----------
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
        <button class="cc-btn">📋 类名复制器</button>
        <div class="cc-sub-row">
            <button class="cc-sub cc-cancel" title="取消选取">✕ 取消</button>
            <button class="cc-sub cc-copy" title="复制选择器">复制</button>
        </div>
        <div class="cc-toast"></div>`;
    document.body.appendChild(panel);

    const selBox = document.createElement('div');
    selBox.id = SELBOX_ID;
    document.body.appendChild(selBox);

    const btn       = panel.querySelector('.cc-btn');
    const btnCancel = panel.querySelector('.cc-cancel');
    const btnCopy   = panel.querySelector('.cc-copy');
    const toast     = panel.querySelector('.cc-toast');

    // ---------- 状态 ----------
    let pluginEnabled = false;
    let active        = false;
    let lastEl        = null;   // 悬停高亮的元素
    let selected      = null;   // 已选中的元素
    let rafId         = 0;
    let drag          = null;
    let pending       = null;
    let synthMode     = false;

    panel.style.display = 'none';

    function clampPos(left, top) {
        const r = panel.getBoundingClientRect();
        return {
            left: Math.max(0, Math.min(left, window.innerWidth  - r.width)),
            top:  Math.max(0, Math.min(top,  window.innerHeight - r.height)),
        };
    }

    try {
        const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        if (saved && isFinite(saved.left) && isFinite(saved.top)) {
            const p = clampPos(saved.left, saved.top);
            panel.style.left  = p.left + 'px';
            panel.style.top   = p.top  + 'px';
            panel.style.right = 'auto';
        }
    } catch (_) { /* ignore */ }

    // ---------- 提示 ----------
    function showToast(msg) {
        toast.textContent = msg;
        toast.style.display = 'block';
        clearTimeout(toast._t);
        toast._t = setTimeout(() => (toast.style.display = 'none'), 1500);
    }

    // ---------- 选择框 ----------
    function drawSelection() {
        if (!selected || !selected.isConnected) {
            selBox.style.display = 'none';
            return;
        }
        const r = selected.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
            selBox.style.display = 'none';
            return;
        }
        selBox.style.display = 'block';
        selBox.style.left   = r.left   + 'px';
        selBox.style.top    = r.top    + 'px';
        selBox.style.width  = r.width  + 'px';
        selBox.style.height = r.height + 'px';
    }

    // 选中期间每帧跟随元素位置（聊天滚动、布局变化时选择框不会错位）
    function trackLoop() {
        drawSelection();
        rafId = selected ? requestAnimationFrame(trackLoop) : 0;
    }

    function selectEl(el) {
        if (!(el instanceof Element) || !el.isConnected) return;
        clearHover();
        selected = el;
        drawSelection();
        if (!rafId) rafId = requestAnimationFrame(trackLoop);
        showToast('已选取：' + getSelector(el));
    }

    function clearSelection() {
        selected = null;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        selBox.style.display = 'none';
    }

    // ---------- 状态切换 ----------
    function setActive(v) {
        if (!pluginEnabled) v = false;
        active = v;
        panel.classList.toggle('on', active);
        btn.textContent = active ? '📋 选取中（开）' : '📋 类名复制器';
        document.documentElement.style.cursor = active ? 'crosshair' : '';
        if (!active) {
            clearHover();
            clearSelection();
            if (pending) { clearTimeout(pending.timer); pending = null; }
        }
    }

    function setPluginEnabled(v) {
        pluginEnabled = v;
        panel.style.display = v ? '' : 'none';
        if (!v) {
            setActive(false);
            clearHover();
            clearSelection();
            if (pending) { clearTimeout(pending.timer); pending = null; }
            document.documentElement.style.cursor = '';
        }
        syncMenuItem();
    }

    // ---------- 剪贴板 ----------
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
            catch (err) { reject(err); }
            ta.remove();
        });
    }

    // ---------- 悬停高亮 ----------
    function clearHover() {
        if (lastEl) { lastEl.classList.remove('cc-highlight'); lastEl = null; }
    }
    function onHover(e) {
        if (!pluginEnabled || !active || drag) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        // 只豁免悬浮面板和本插件菜单项
        if (t.closest('#' + PANEL_ID + ', #' + MENU_ITEM_ID)) {
            clearHover();
            return;
        }
        if (t === lastEl) return;
        if (lastEl) lastEl.classList.remove('cc-highlight');
        lastEl = t;
        t.classList.add('cc-highlight');
    }

    // ---------- 选择器生成（id / class，CSS 选择器格式） ----------
    function getSelector(el) {
        let sel = '';
        if (el.id) sel = '#' + CSS.escape(el.id);
        if (el.classList && el.classList.length) {
            sel += [...el.classList]
                .filter(c => c !== 'cc-highlight')
                .map(c => '.' + CSS.escape(c))
                .join('');
        }
        if (!sel) sel = el.tagName.toLowerCase();
        return sel;
    }

    // ---------- 复制（由"复制"小按钮触发） ----------
    function handleCopy() {
        if (!selected || !selected.isConnected) {
            showToast('还没有选取元素，请先单击要复制的元素');
            return;
        }
        const sel = getSelector(selected);
        copyText(sel)
            .then(() => showToast('已复制：' + sel))
            .catch(() => showToast('复制失败：' + sel));
    }

    // ---------- 合成事件（双击穿透） ----------
    function fireSynthetic(target, x, y) {
        if (!(target instanceof Element)) return;
        const base = {
            bubbles: true, cancelable: true, composed: true,
            view: window,
            clientX: x, clientY: y,
            screenX: x, screenY: y,
            button: 0, detail: 1,
        };
        synthMode = true;
        try {
            const pd = new PointerEvent('pointerdown', { ...base, buttons: 1,
                pointerId: 1, pointerType: 'mouse', isPrimary: true });
            const pu = new PointerEvent('pointerup',   { ...base, buttons: 0,
                pointerId: 1, pointerType: 'mouse', isPrimary: true });
            const md = new MouseEvent('mousedown', { ...base, buttons: 1 });
            const mu = new MouseEvent('mouseup',   { ...base, buttons: 0 });
            const ck = new MouseEvent('click',     { ...base, buttons: 0 });

            target.dispatchEvent(pd);
            target.dispatchEvent(md);
            target.dispatchEvent(pu);
            target.dispatchEvent(mu);
            target.dispatchEvent(ck);
        } finally {
            synthMode = false;
        }
    }

    // ---------- 豁免区 ----------
    // 只豁免：悬浮面板自身（含下方的取消/复制按钮）、本插件菜单项。
    // 魔棒按钮、菜单内其它插件项都不豁免 →
    //   单击 = 选取它们；双击 = 触发它们原本功能。
    function isExempt(e) {
        const t = e.target;
        if (!(t instanceof Element)) return false;
        return !!t.closest('#' + PANEL_ID + ', #' + MENU_ITEM_ID);
    }

    // ---------- 全局拦截器 ----------
    const BLOCKED = [
        'pointerdown', 'mousedown', 'pointerup', 'mouseup',
        'click', 'dblclick', 'contextmenu', 'auxclick',
        'touchstart', 'touchend',
    ];

    function intercept(e) {
        if (!pluginEnabled || !active || drag || synthMode) return;
        if (isExempt(e)) return;

        if (e.type === 'pointerdown') {
            if (e.pointerType === 'mouse' && e.button !== 0) {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                return;
            }

            const x = e.clientX, y = e.clientY;
            const target = e.target;

            if (pending) {
                const near = Math.hypot(x - pending.x, y - pending.y) <= DBLCLICK_DIST;
                if (near) {
                    clearTimeout(pending.timer);
                    pending = null;
                    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                    fireSynthetic(target, x, y);
                    return;
                }
            }

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const entry = { x, y, target, timer: null };
            entry.timer = setTimeout(() => {
                if (pending === entry) pending = null;
                selectEl(entry.target);   // 单击 = 选取元素（不再直接复制）
            }, DBLCLICK_MS);
            pending = entry;
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    }

    for (const t of BLOCKED) window.addEventListener(t, intercept, true);
    window.addEventListener('pointermove', onHover, true);
    window.addEventListener('scroll', () => { if (active) clearHover(); }, true);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && active) setActive(false);
    }, true);

    // ---------- 悬浮按钮：拖动 + 选取模式开关 ----------
    btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const r = panel.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
        try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });

    btn.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
            drag.moved = true;
            panel.classList.add('dragging');
        }
        if (drag.moved) {
            const p = clampPos(drag.left + dx, drag.top + dy);
            panel.style.left  = p.left + 'px';
            panel.style.top   = p.top  + 'px';
            panel.style.right = 'auto';
        }
    });

    btn.addEventListener('pointerup', (e) => {
        if (!drag) return;
        try { btn.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        const moved = drag.moved;
        drag = null;
        panel.classList.remove('dragging');
        if (moved) {
            const r = panel.getBoundingClientRect();
            try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top })); }
            catch (_) { /* ignore */ }
        } else {
            setActive(!active);
        }
    });

    btn.addEventListener('pointercancel', () => {
        drag = null;
        panel.classList.remove('dragging');
    });

    // ---------- 悬浮按钮下方：取消 / 复制 ----------
    btnCancel.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);          // 清除选择框 + 退出选取模式
        showToast('已取消选取');
    });

    btnCopy.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCopy();
    });

    // ============================================================
    // 魔棒菜单：总开关
    // ============================================================
    function buildMenuItem() {
        const item = document.createElement('div');
        item.id = MENU_ITEM_ID;
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.innerHTML = `
            <div class="fa-solid fa-copy extensionsMenuExtensionButton"></div>
            <span class="cc-menu-label">类名复制器：关</span>`;
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setPluginEnabled(!pluginEnabled);
        });
        item.addEventListener('pointerdown', (e) => e.stopPropagation());
        return item;
    }

    function syncMenuItem() {
        const item = document.getElementById(MENU_ITEM_ID);
        if (!item) return;
        const label = item.querySelector('.cc-menu-label');
        if (label) label.textContent = '类名复制器：' + (pluginEnabled ? '开' : '关');
        item.classList.toggle('cc-menu-on', pluginEnabled);
    }

    function injectMenuItem() {
        const menu = document.getElementById('extensionsMenu')
                  || document.getElementById('extensions_menu');
        if (!menu) return false;
        if (menu.querySelector('#' + MENU_ITEM_ID)) { syncMenuItem(); return true; }
        menu.appendChild(buildMenuItem());
        syncMenuItem();
        return true;
    }

    const menuWait = setInterval(() => { if (injectMenuItem()) clearInterval(menuWait); }, 500);

    const menuObs = new MutationObserver(() => {
        const menu = document.getElementById('extensionsMenu')
                  || document.getElementById('extensions_menu');
        if (menu && !menu.querySelector('#' + MENU_ITEM_ID)) {
            injectMenuItem();
        }
    });
    menuObs.observe(document.body, { childList: true, subtree: true });
})();
