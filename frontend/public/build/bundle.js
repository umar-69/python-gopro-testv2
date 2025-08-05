
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    const globals = (typeof window !== 'undefined'
        ? window
        : typeof globalThis !== 'undefined'
            ? globalThis
            : global);
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        if (value == null) {
            node.style.removeProperty(key);
        }
        else {
            node.style.setProperty(key, value, important ? 'important' : '');
        }
    }
    function custom_event(type, detail, { bubbles = false, cancelable = false } = {}) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, cancelable, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    /**
     * Schedules a callback to run immediately before the component is unmounted.
     *
     * Out of `onMount`, `beforeUpdate`, `afterUpdate` and `onDestroy`, this is the
     * only one that runs inside a server-side component.
     *
     * https://svelte.dev/docs#run-time-svelte-ondestroy
     */
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    let render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = /* @__PURE__ */ Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    /**
     * Useful for example to execute remaining `afterUpdate` callbacks before executing `destroy`.
     */
    function flush_render_callbacks(fns) {
        const filtered = [];
        const targets = [];
        render_callbacks.forEach((c) => fns.indexOf(c) === -1 ? filtered.push(c) : targets.push(c));
        targets.forEach((c) => c());
        render_callbacks = filtered;
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            flush_render_callbacks($$.after_update);
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.59.2' }, detail), { bubbles: true }));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation, has_stop_immediate_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        if (has_stop_immediate_propagation)
            modifiers.push('stopImmediatePropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* src/App.svelte generated by Svelte v3.59.2 */

    const { console: console_1 } = globals;
    const file = "src/App.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[27] = list[i];
    	return child_ctx;
    }

    // (290:2) {#if savedDevice}
    function create_if_block_4(ctx) {
    	let div5;
    	let h3;
    	let t1;
    	let div0;
    	let span0;
    	let t3;
    	let span1;
    	let t4_value = /*savedDevice*/ ctx[7].model + "";
    	let t4;
    	let t5;
    	let div1;
    	let span2;
    	let t7;
    	let span3;
    	let t8_value = /*savedDevice*/ ctx[7].serial + "";
    	let t8;
    	let t9;
    	let div2;
    	let span4;
    	let t11;
    	let span5;
    	let t12_value = /*savedDevice*/ ctx[7].last_connected + "";
    	let t12;
    	let t13;
    	let div3;
    	let span6;
    	let t15;
    	let span7;
    	let t16_value = (/*autoReconnectEnabled*/ ctx[8] ? 'Enabled' : 'Disabled') + "";
    	let t16;
    	let span7_class_value;
    	let t17;
    	let div4;
    	let button0;

    	let t18_value = (/*autoReconnectEnabled*/ ctx[8]
    	? '🔄 Disable Auto-Reconnect'
    	: '🔄 Enable Auto-Reconnect') + "";

    	let t18;
    	let t19;
    	let button1;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			h3 = element("h3");
    			h3.textContent = "📱 Remembered Device";
    			t1 = space();
    			div0 = element("div");
    			span0 = element("span");
    			span0.textContent = "Model:";
    			t3 = space();
    			span1 = element("span");
    			t4 = text(t4_value);
    			t5 = space();
    			div1 = element("div");
    			span2 = element("span");
    			span2.textContent = "Serial:";
    			t7 = space();
    			span3 = element("span");
    			t8 = text(t8_value);
    			t9 = space();
    			div2 = element("div");
    			span4 = element("span");
    			span4.textContent = "Last Connected:";
    			t11 = space();
    			span5 = element("span");
    			t12 = text(t12_value);
    			t13 = space();
    			div3 = element("div");
    			span6 = element("span");
    			span6.textContent = "Auto-Reconnect:";
    			t15 = space();
    			span7 = element("span");
    			t16 = text(t16_value);
    			t17 = space();
    			div4 = element("div");
    			button0 = element("button");
    			t18 = text(t18_value);
    			t19 = space();
    			button1 = element("button");
    			button1.textContent = "🗑️ Forget Device";
    			set_style(h3, "margin", "0 0 15px 0");
    			set_style(h3, "color", "#333");
    			add_location(h3, file, 291, 4, 7982);
    			attr_dev(span0, "class", "status-label svelte-1utpor9");
    			add_location(span0, file, 293, 5, 8088);
    			attr_dev(span1, "class", "status-value svelte-1utpor9");
    			add_location(span1, file, 294, 5, 8134);
    			attr_dev(div0, "class", "status-item svelte-1utpor9");
    			add_location(div0, file, 292, 4, 8057);
    			attr_dev(span2, "class", "status-label svelte-1utpor9");
    			add_location(span2, file, 297, 5, 8234);
    			attr_dev(span3, "class", "status-value svelte-1utpor9");
    			add_location(span3, file, 298, 5, 8281);
    			attr_dev(div1, "class", "status-item svelte-1utpor9");
    			add_location(div1, file, 296, 4, 8203);
    			attr_dev(span4, "class", "status-label svelte-1utpor9");
    			add_location(span4, file, 301, 5, 8382);
    			attr_dev(span5, "class", "status-value svelte-1utpor9");
    			add_location(span5, file, 302, 5, 8437);
    			attr_dev(div2, "class", "status-item svelte-1utpor9");
    			add_location(div2, file, 300, 4, 8351);
    			attr_dev(span6, "class", "status-label svelte-1utpor9");
    			add_location(span6, file, 305, 5, 8546);

    			attr_dev(span7, "class", span7_class_value = "status-value " + (/*autoReconnectEnabled*/ ctx[8]
    			? 'connected'
    			: 'disconnected') + " svelte-1utpor9");

    			add_location(span7, file, 306, 5, 8601);
    			attr_dev(div3, "class", "status-item svelte-1utpor9");
    			add_location(div3, file, 304, 4, 8515);
    			attr_dev(button0, "class", "btn secondary svelte-1utpor9");
    			add_location(button0, file, 311, 5, 8823);
    			attr_dev(button1, "class", "btn danger svelte-1utpor9");
    			add_location(button1, file, 314, 5, 8993);
    			attr_dev(div4, "class", "button-group svelte-1utpor9");
    			set_style(div4, "margin-top", "15px");
    			add_location(div4, file, 310, 4, 8765);
    			attr_dev(div5, "class", "status-panel svelte-1utpor9");
    			add_location(div5, file, 290, 3, 7951);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, h3);
    			append_dev(div5, t1);
    			append_dev(div5, div0);
    			append_dev(div0, span0);
    			append_dev(div0, t3);
    			append_dev(div0, span1);
    			append_dev(span1, t4);
    			append_dev(div5, t5);
    			append_dev(div5, div1);
    			append_dev(div1, span2);
    			append_dev(div1, t7);
    			append_dev(div1, span3);
    			append_dev(span3, t8);
    			append_dev(div5, t9);
    			append_dev(div5, div2);
    			append_dev(div2, span4);
    			append_dev(div2, t11);
    			append_dev(div2, span5);
    			append_dev(span5, t12);
    			append_dev(div5, t13);
    			append_dev(div5, div3);
    			append_dev(div3, span6);
    			append_dev(div3, t15);
    			append_dev(div3, span7);
    			append_dev(span7, t16);
    			append_dev(div5, t17);
    			append_dev(div5, div4);
    			append_dev(div4, button0);
    			append_dev(button0, t18);
    			append_dev(div4, t19);
    			append_dev(div4, button1);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*toggleAutoReconnect*/ ctx[17], false, false, false, false),
    					listen_dev(button1, "click", /*clearSavedDevice*/ ctx[16], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*savedDevice*/ 128 && t4_value !== (t4_value = /*savedDevice*/ ctx[7].model + "")) set_data_dev(t4, t4_value);
    			if (dirty & /*savedDevice*/ 128 && t8_value !== (t8_value = /*savedDevice*/ ctx[7].serial + "")) set_data_dev(t8, t8_value);
    			if (dirty & /*savedDevice*/ 128 && t12_value !== (t12_value = /*savedDevice*/ ctx[7].last_connected + "")) set_data_dev(t12, t12_value);
    			if (dirty & /*autoReconnectEnabled*/ 256 && t16_value !== (t16_value = (/*autoReconnectEnabled*/ ctx[8] ? 'Enabled' : 'Disabled') + "")) set_data_dev(t16, t16_value);

    			if (dirty & /*autoReconnectEnabled*/ 256 && span7_class_value !== (span7_class_value = "status-value " + (/*autoReconnectEnabled*/ ctx[8]
    			? 'connected'
    			: 'disconnected') + " svelte-1utpor9")) {
    				attr_dev(span7, "class", span7_class_value);
    			}

    			if (dirty & /*autoReconnectEnabled*/ 256 && t18_value !== (t18_value = (/*autoReconnectEnabled*/ ctx[8]
    			? '🔄 Disable Auto-Reconnect'
    			: '🔄 Enable Auto-Reconnect') + "")) set_data_dev(t18, t18_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div5);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_4.name,
    		type: "if",
    		source: "(290:2) {#if savedDevice}",
    		ctx
    	});

    	return block;
    }

    // (329:3) {#if connected && cameraInfo.model}
    function create_if_block_3(ctx) {
    	let div0;
    	let span0;
    	let t1;
    	let span1;
    	let t2_value = /*cameraInfo*/ ctx[3].model + "";
    	let t2;
    	let t3;
    	let div1;
    	let span2;
    	let t5;
    	let span3;
    	let t6_value = /*cameraInfo*/ ctx[3].serial + "";
    	let t6;
    	let t7;
    	let div2;
    	let span4;
    	let t9;
    	let span5;

    	let t10_value = (/*wifiConnected*/ ctx[4]
    	? 'WiFi (HTTP)'
    	: 'Not Connected') + "";

    	let t10;
    	let span5_class_value;

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			span0 = element("span");
    			span0.textContent = "Camera:";
    			t1 = space();
    			span1 = element("span");
    			t2 = text(t2_value);
    			t3 = space();
    			div1 = element("div");
    			span2 = element("span");
    			span2.textContent = "Serial:";
    			t5 = space();
    			span3 = element("span");
    			t6 = text(t6_value);
    			t7 = space();
    			div2 = element("div");
    			span4 = element("span");
    			span4.textContent = "Connection Type:";
    			t9 = space();
    			span5 = element("span");
    			t10 = text(t10_value);
    			attr_dev(span0, "class", "status-label svelte-1utpor9");
    			add_location(span0, file, 330, 5, 9404);
    			attr_dev(span1, "class", "status-value svelte-1utpor9");
    			add_location(span1, file, 331, 5, 9451);
    			attr_dev(div0, "class", "status-item svelte-1utpor9");
    			add_location(div0, file, 329, 4, 9373);
    			attr_dev(span2, "class", "status-label svelte-1utpor9");
    			add_location(span2, file, 334, 5, 9550);
    			attr_dev(span3, "class", "status-value svelte-1utpor9");
    			add_location(span3, file, 335, 5, 9597);
    			attr_dev(div1, "class", "status-item svelte-1utpor9");
    			add_location(div1, file, 333, 4, 9519);
    			attr_dev(span4, "class", "status-label svelte-1utpor9");
    			add_location(span4, file, 338, 5, 9697);
    			attr_dev(span5, "class", span5_class_value = "status-value " + (/*wifiConnected*/ ctx[4] ? 'connected' : 'disconnected') + " svelte-1utpor9");
    			add_location(span5, file, 339, 5, 9753);
    			attr_dev(div2, "class", "status-item svelte-1utpor9");
    			add_location(div2, file, 337, 4, 9666);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			append_dev(div0, span0);
    			append_dev(div0, t1);
    			append_dev(div0, span1);
    			append_dev(span1, t2);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, div1, anchor);
    			append_dev(div1, span2);
    			append_dev(div1, t5);
    			append_dev(div1, span3);
    			append_dev(span3, t6);
    			insert_dev(target, t7, anchor);
    			insert_dev(target, div2, anchor);
    			append_dev(div2, span4);
    			append_dev(div2, t9);
    			append_dev(div2, span5);
    			append_dev(span5, t10);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*cameraInfo*/ 8 && t2_value !== (t2_value = /*cameraInfo*/ ctx[3].model + "")) set_data_dev(t2, t2_value);
    			if (dirty & /*cameraInfo*/ 8 && t6_value !== (t6_value = /*cameraInfo*/ ctx[3].serial + "")) set_data_dev(t6, t6_value);

    			if (dirty & /*wifiConnected*/ 16 && t10_value !== (t10_value = (/*wifiConnected*/ ctx[4]
    			? 'WiFi (HTTP)'
    			: 'Not Connected') + "")) set_data_dev(t10, t10_value);

    			if (dirty & /*wifiConnected*/ 16 && span5_class_value !== (span5_class_value = "status-value " + (/*wifiConnected*/ ctx[4] ? 'connected' : 'disconnected') + " svelte-1utpor9")) {
    				attr_dev(span5, "class", span5_class_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(div1);
    			if (detaching) detach_dev(t7);
    			if (detaching) detach_dev(div2);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_3.name,
    		type: "if",
    		source: "(329:3) {#if connected && cameraInfo.model}",
    		ctx
    	});

    	return block;
    }

    // (387:3) {:else}
    function create_else_block(ctx) {
    	let div0;
    	let button0;
    	let t1;
    	let button1;
    	let t3;
    	let div1;
    	let t4;
    	let div2;
    	let button2;
    	let t5;
    	let button2_disabled_value;
    	let t6;
    	let button3;
    	let mounted;
    	let dispose;

    	function select_block_type_1(ctx, dirty) {
    		if (!/*recording*/ ctx[1]) return create_if_block_2;
    		return create_else_block_1;
    	}

    	let current_block_type = select_block_type_1(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			button0 = element("button");
    			button0.textContent = "🔌 Disconnect";
    			t1 = space();
    			button1 = element("button");
    			button1.textContent = "⚙️ Configure Settings";
    			t3 = space();
    			div1 = element("div");
    			if_block.c();
    			t4 = space();
    			div2 = element("div");
    			button2 = element("button");
    			t5 = text("⬇️ Download Latest");
    			t6 = space();
    			button3 = element("button");
    			button3.textContent = "🔄 Refresh Status";
    			attr_dev(button0, "class", "btn secondary svelte-1utpor9");
    			add_location(button0, file, 388, 5, 10983);
    			attr_dev(button1, "class", "btn accent svelte-1utpor9");
    			add_location(button1, file, 391, 5, 11081);
    			attr_dev(div0, "class", "button-group svelte-1utpor9");
    			add_location(div0, file, 387, 4, 10951);
    			attr_dev(div1, "class", "button-group svelte-1utpor9");
    			add_location(div1, file, 396, 4, 11201);
    			attr_dev(button2, "class", "btn info svelte-1utpor9");
    			button2.disabled = button2_disabled_value = !/*wifiConnected*/ ctx[4];
    			add_location(button2, file, 409, 5, 11541);
    			attr_dev(button3, "class", "btn secondary svelte-1utpor9");
    			add_location(button3, file, 416, 5, 11690);
    			attr_dev(div2, "class", "button-group svelte-1utpor9");
    			add_location(div2, file, 408, 4, 11509);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			append_dev(div0, button0);
    			append_dev(div0, t1);
    			append_dev(div0, button1);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, div1, anchor);
    			if_block.m(div1, null);
    			insert_dev(target, t4, anchor);
    			insert_dev(target, div2, anchor);
    			append_dev(div2, button2);
    			append_dev(button2, t5);
    			append_dev(div2, t6);
    			append_dev(div2, button3);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*disconnectGoPro*/ ctx[10], false, false, false, false),
    					listen_dev(button1, "click", /*configureSettings*/ ctx[14], false, false, false, false),
    					listen_dev(button2, "click", /*downloadLatest*/ ctx[13], false, false, false, false),
    					listen_dev(button3, "click", /*refreshStatus*/ ctx[18], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (current_block_type === (current_block_type = select_block_type_1(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div1, null);
    				}
    			}

    			if (dirty & /*wifiConnected*/ 16 && button2_disabled_value !== (button2_disabled_value = !/*wifiConnected*/ ctx[4])) {
    				prop_dev(button2, "disabled", button2_disabled_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(div1);
    			if_block.d();
    			if (detaching) detach_dev(t4);
    			if (detaching) detach_dev(div2);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(387:3) {:else}",
    		ctx
    	});

    	return block;
    }

    // (349:3) {#if !connected}
    function create_if_block_1(ctx) {
    	let div0;
    	let button0;

    	let t0_value = (/*connecting*/ ctx[2]
    	? 'Connecting WiFi+COHN...'
    	: '🔗 Connect WiFi+COHN') + "";

    	let t0;
    	let t1;
    	let button1;
    	let t2;
    	let t3;
    	let div1;
    	let button2;
    	let t4;
    	let t5;
    	let button3;
    	let t6;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div0 = element("div");
    			button0 = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			button1 = element("button");
    			t2 = text("🚀 Auto-Connect");
    			t3 = space();
    			div1 = element("div");
    			button2 = element("button");
    			t4 = text("📶 WiFi Connect");
    			t5 = space();
    			button3 = element("button");
    			t6 = text("🔄 Force Reconnect");
    			attr_dev(button0, "class", "btn primary svelte-1utpor9");
    			button0.disabled = /*connecting*/ ctx[2];
    			attr_dev(button0, "title", "WiFi+COHN combined connection (most stable)");
    			add_location(button0, file, 350, 5, 10035);
    			attr_dev(button1, "class", "btn accent svelte-1utpor9");
    			button1.disabled = /*connecting*/ ctx[2];
    			add_location(button1, file, 358, 5, 10286);
    			attr_dev(div0, "class", "button-group svelte-1utpor9");
    			add_location(div0, file, 349, 4, 10003);
    			attr_dev(button2, "class", "btn info svelte-1utpor9");
    			button2.disabled = /*connecting*/ ctx[2];
    			attr_dev(button2, "title", "Connect via WiFi with saved password (most stable)");
    			add_location(button2, file, 369, 5, 10515);
    			attr_dev(button3, "class", "btn secondary svelte-1utpor9");
    			button3.disabled = /*connecting*/ ctx[2];
    			attr_dev(button3, "title", "Force fresh WiFi connection (clears cache)");
    			add_location(button3, file, 377, 5, 10723);
    			attr_dev(div1, "class", "button-group svelte-1utpor9");
    			add_location(div1, file, 368, 4, 10483);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div0, anchor);
    			append_dev(div0, button0);
    			append_dev(button0, t0);
    			append_dev(div0, t1);
    			append_dev(div0, button1);
    			append_dev(button1, t2);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, div1, anchor);
    			append_dev(div1, button2);
    			append_dev(button2, t4);
    			append_dev(div1, t5);
    			append_dev(div1, button3);
    			append_dev(button3, t6);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*connectGoPro*/ ctx[9], false, false, false, false),
    					listen_dev(button1, "click", /*autoConnect*/ ctx[15], false, false, false, false),
    					listen_dev(button2, "click", /*wifiOnlyConnect*/ ctx[20], false, false, false, false),
    					listen_dev(button3, "click", /*forceReconnect*/ ctx[19], false, false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*connecting*/ 4 && t0_value !== (t0_value = (/*connecting*/ ctx[2]
    			? 'Connecting WiFi+COHN...'
    			: '🔗 Connect WiFi+COHN') + "")) set_data_dev(t0, t0_value);

    			if (dirty & /*connecting*/ 4) {
    				prop_dev(button0, "disabled", /*connecting*/ ctx[2]);
    			}

    			if (dirty & /*connecting*/ 4) {
    				prop_dev(button1, "disabled", /*connecting*/ ctx[2]);
    			}

    			if (dirty & /*connecting*/ 4) {
    				prop_dev(button2, "disabled", /*connecting*/ ctx[2]);
    			}

    			if (dirty & /*connecting*/ 4) {
    				prop_dev(button3, "disabled", /*connecting*/ ctx[2]);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div0);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(div1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(349:3) {#if !connected}",
    		ctx
    	});

    	return block;
    }

    // (402:5) {:else}
    function create_else_block_1(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "⏹️ Stop Recording";
    			attr_dev(button, "class", "btn danger large svelte-1utpor9");
    			add_location(button, file, 402, 6, 11378);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*stopRecording*/ ctx[12], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block_1.name,
    		type: "else",
    		source: "(402:5) {:else}",
    		ctx
    	});

    	return block;
    }

    // (398:5) {#if !recording}
    function create_if_block_2(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "▶️ Start Recording";
    			attr_dev(button, "class", "btn success large svelte-1utpor9");
    			add_location(button, file, 398, 6, 11256);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*startRecording*/ ctx[11], false, false, false, false);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_2.name,
    		type: "if",
    		source: "(398:5) {#if !recording}",
    		ctx
    	});

    	return block;
    }

    // (428:4) {#each messages as message}
    function create_each_block(ctx) {
    	let div;
    	let span0;
    	let t0_value = /*message*/ ctx[27].timestamp + "";
    	let t0;
    	let t1;
    	let span1;
    	let t2_value = /*message*/ ctx[27].text + "";
    	let t2;
    	let div_class_value;

    	const block = {
    		c: function create() {
    			div = element("div");
    			span0 = element("span");
    			t0 = text(t0_value);
    			t1 = space();
    			span1 = element("span");
    			t2 = text(t2_value);
    			attr_dev(span0, "class", "timestamp svelte-1utpor9");
    			add_location(span0, file, 429, 6, 12001);
    			attr_dev(span1, "class", "text svelte-1utpor9");
    			add_location(span1, file, 430, 6, 12058);
    			attr_dev(div, "class", div_class_value = "message " + /*message*/ ctx[27].type + " svelte-1utpor9");
    			add_location(div, file, 428, 5, 11958);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, span0);
    			append_dev(span0, t0);
    			append_dev(div, t1);
    			append_dev(div, span1);
    			append_dev(span1, t2);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*messages*/ 64 && t0_value !== (t0_value = /*message*/ ctx[27].timestamp + "")) set_data_dev(t0, t0_value);
    			if (dirty & /*messages*/ 64 && t2_value !== (t2_value = /*message*/ ctx[27].text + "")) set_data_dev(t2, t2_value);

    			if (dirty & /*messages*/ 64 && div_class_value !== (div_class_value = "message " + /*message*/ ctx[27].type + " svelte-1utpor9")) {
    				attr_dev(div, "class", div_class_value);
    			}
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(428:4) {#each messages as message}",
    		ctx
    	});

    	return block;
    }

    // (434:4) {#if messages.length === 0}
    function create_if_block(ctx) {
    	let div;
    	let span;

    	const block = {
    		c: function create() {
    			div = element("div");
    			span = element("span");
    			span.textContent = "No messages yet...";
    			attr_dev(span, "class", "text svelte-1utpor9");
    			add_location(span, file, 435, 6, 12193);
    			attr_dev(div, "class", "message info svelte-1utpor9");
    			add_location(div, file, 434, 5, 12160);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, span);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(434:4) {#if messages.length === 0}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let main;
    	let div5;
    	let h1;
    	let t1;
    	let t2;
    	let div1;
    	let div0;
    	let span0;
    	let t4;
    	let span1;
    	let t5;
    	let span1_class_value;
    	let t6;
    	let t7;
    	let div2;
    	let t8;
    	let div4;
    	let h3;
    	let t10;
    	let div3;
    	let t11;
    	let if_block0 = /*savedDevice*/ ctx[7] && create_if_block_4(ctx);
    	let if_block1 = /*connected*/ ctx[0] && /*cameraInfo*/ ctx[3].model && create_if_block_3(ctx);

    	function select_block_type(ctx, dirty) {
    		if (!/*connected*/ ctx[0]) return create_if_block_1;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block2 = current_block_type(ctx);
    	let each_value = /*messages*/ ctx[6];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let if_block3 = /*messages*/ ctx[6].length === 0 && create_if_block(ctx);

    	const block = {
    		c: function create() {
    			main = element("main");
    			div5 = element("div");
    			h1 = element("h1");
    			h1.textContent = "🎥 GoPro Web Controller";
    			t1 = space();
    			if (if_block0) if_block0.c();
    			t2 = space();
    			div1 = element("div");
    			div0 = element("div");
    			span0 = element("span");
    			span0.textContent = "Status:";
    			t4 = space();
    			span1 = element("span");
    			t5 = text(/*status*/ ctx[5]);
    			t6 = space();
    			if (if_block1) if_block1.c();
    			t7 = space();
    			div2 = element("div");
    			if_block2.c();
    			t8 = space();
    			div4 = element("div");
    			h3 = element("h3");
    			h3.textContent = "📋 Activity Log";
    			t10 = space();
    			div3 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t11 = space();
    			if (if_block3) if_block3.c();
    			attr_dev(h1, "class", "svelte-1utpor9");
    			add_location(h1, file, 286, 2, 7862);
    			attr_dev(span0, "class", "status-label svelte-1utpor9");
    			add_location(span0, file, 324, 4, 9204);
    			attr_dev(span1, "class", span1_class_value = "status-value " + /*status*/ ctx[5].toLowerCase() + " svelte-1utpor9");
    			add_location(span1, file, 325, 4, 9250);
    			attr_dev(div0, "class", "status-item svelte-1utpor9");
    			add_location(div0, file, 323, 3, 9174);
    			attr_dev(div1, "class", "status-panel svelte-1utpor9");
    			add_location(div1, file, 322, 2, 9144);
    			attr_dev(div2, "class", "controls svelte-1utpor9");
    			add_location(div2, file, 347, 2, 9956);
    			attr_dev(h3, "class", "svelte-1utpor9");
    			add_location(h3, file, 425, 3, 11866);
    			attr_dev(div3, "class", "message-list svelte-1utpor9");
    			add_location(div3, file, 426, 3, 11894);
    			attr_dev(div4, "class", "messages svelte-1utpor9");
    			add_location(div4, file, 424, 2, 11840);
    			attr_dev(div5, "class", "container svelte-1utpor9");
    			add_location(div5, file, 285, 1, 7836);
    			attr_dev(main, "class", "svelte-1utpor9");
    			add_location(main, file, 284, 0, 7828);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, div5);
    			append_dev(div5, h1);
    			append_dev(div5, t1);
    			if (if_block0) if_block0.m(div5, null);
    			append_dev(div5, t2);
    			append_dev(div5, div1);
    			append_dev(div1, div0);
    			append_dev(div0, span0);
    			append_dev(div0, t4);
    			append_dev(div0, span1);
    			append_dev(span1, t5);
    			append_dev(div1, t6);
    			if (if_block1) if_block1.m(div1, null);
    			append_dev(div5, t7);
    			append_dev(div5, div2);
    			if_block2.m(div2, null);
    			append_dev(div5, t8);
    			append_dev(div5, div4);
    			append_dev(div4, h3);
    			append_dev(div4, t10);
    			append_dev(div4, div3);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				if (each_blocks[i]) {
    					each_blocks[i].m(div3, null);
    				}
    			}

    			append_dev(div3, t11);
    			if (if_block3) if_block3.m(div3, null);
    		},
    		p: function update(ctx, [dirty]) {
    			if (/*savedDevice*/ ctx[7]) {
    				if (if_block0) {
    					if_block0.p(ctx, dirty);
    				} else {
    					if_block0 = create_if_block_4(ctx);
    					if_block0.c();
    					if_block0.m(div5, t2);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (dirty & /*status*/ 32) set_data_dev(t5, /*status*/ ctx[5]);

    			if (dirty & /*status*/ 32 && span1_class_value !== (span1_class_value = "status-value " + /*status*/ ctx[5].toLowerCase() + " svelte-1utpor9")) {
    				attr_dev(span1, "class", span1_class_value);
    			}

    			if (/*connected*/ ctx[0] && /*cameraInfo*/ ctx[3].model) {
    				if (if_block1) {
    					if_block1.p(ctx, dirty);
    				} else {
    					if_block1 = create_if_block_3(ctx);
    					if_block1.c();
    					if_block1.m(div1, null);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block2) {
    				if_block2.p(ctx, dirty);
    			} else {
    				if_block2.d(1);
    				if_block2 = current_block_type(ctx);

    				if (if_block2) {
    					if_block2.c();
    					if_block2.m(div2, null);
    				}
    			}

    			if (dirty & /*messages*/ 64) {
    				each_value = /*messages*/ ctx[6];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div3, t11);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (/*messages*/ ctx[6].length === 0) {
    				if (if_block3) ; else {
    					if_block3 = create_if_block(ctx);
    					if_block3.c();
    					if_block3.m(div3, null);
    				}
    			} else if (if_block3) {
    				if_block3.d(1);
    				if_block3 = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			if_block2.d();
    			destroy_each(each_blocks, detaching);
    			if (if_block3) if_block3.d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    const API_BASE = 'http://localhost:8000/api';
    const WS_URL = 'ws://localhost:8000/ws';

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	let connected = false;
    	let recording = false;
    	let connecting = false;
    	let cameraInfo = { model: '', serial: '', firmware: '' };
    	let wifiConnected = false;
    	let status = 'Disconnected';
    	let messages = [];
    	let ws = null;
    	let savedDevice = null;
    	let autoReconnectEnabled = true;

    	// Add message to the log
    	function addMessage(type, text) {
    		const timestamp = new Date().toLocaleTimeString();
    		$$invalidate(6, messages = [...messages, { type, text, timestamp }]);

    		// Keep only last 10 messages
    		if (messages.length > 10) {
    			$$invalidate(6, messages = messages.slice(-10));
    		}
    	}

    	// WebSocket connection
    	function connectWebSocket() {
    		try {
    			ws = new WebSocket(WS_URL);

    			ws.onopen = () => {
    				console.log('WebSocket connected');
    				addMessage('info', 'Real-time connection established');
    			};

    			ws.onmessage = event => {
    				const data = JSON.parse(event.data);
    				console.log('WebSocket message:', data);

    				if (data.type === 'status') {
    					updateStatus(data.data);
    				} else if (data.type === 'connection') {
    					addMessage(data.data.success ? 'success' : 'error', data.data.message);

    					// Refresh device status when connection changes
    					if (data.data.success) {
    						checkSavedDevice();
    					}
    				} else if (data.type === 'recording') {
    					addMessage(data.data.success ? 'success' : 'error', data.data.message);
    				} else if (data.type === 'download') {
    					addMessage(data.data.success ? 'success' : 'error', data.data.message);
    				} else if (data.type === 'device_cleared') {
    					addMessage(data.data.success ? 'success' : 'error', data.data.message);

    					if (data.data.success) {
    						$$invalidate(7, savedDevice = null);
    					}
    				}
    			};

    			ws.onclose = () => {
    				console.log('WebSocket disconnected');
    				addMessage('warning', 'Real-time connection lost. Attempting to reconnect...');

    				// Attempt to reconnect after 3 seconds
    				setTimeout(connectWebSocket, 3000);
    			};

    			ws.onerror = error => {
    				console.error('WebSocket error:', error);
    				addMessage('error', 'WebSocket connection error');
    			};
    		} catch(error) {
    			console.error('Failed to connect WebSocket:', error);
    			addMessage('error', 'Failed to establish real-time connection');
    		}
    	}

    	// Update status from WebSocket
    	function updateStatus(statusData) {
    		$$invalidate(0, connected = statusData.connected);
    		$$invalidate(1, recording = statusData.recording);
    		$$invalidate(3, cameraInfo = statusData.camera_info);
    		$$invalidate(4, wifiConnected = statusData.wifi_connected);

    		if (connected) {
    			$$invalidate(5, status = recording ? 'Recording' : 'Connected');
    		} else {
    			$$invalidate(5, status = 'Disconnected');
    		}
    	}

    	// API call helper
    	async function apiCall(endpoint, method = 'GET') {
    		try {
    			const response = await fetch(`${API_BASE}${endpoint}`, {
    				method,
    				headers: { 'Content-Type': 'application/json' }
    			});

    			return await response.json();
    		} catch(error) {
    			console.error('API call failed:', error);
    			addMessage('error', `API call failed: ${error.message}`);
    			return { success: false, message: error.message };
    		}
    	}

    	// Connect to GoPro using WiFi+COHN combined approach
    	async function connectGoPro() {
    		$$invalidate(2, connecting = true);
    		addMessage('info', 'Connecting via WiFi+COHN combined (most stable)...');
    		const result = await apiCall('/connect', 'POST');
    		$$invalidate(2, connecting = false);

    		if (result.success) {
    			addMessage('success', 'Connected via WiFi+COHN successfully!');
    		} else {
    			addMessage('error', `Connection failed: ${result.message}`);
    		}
    	}

    	// Disconnect from GoPro
    	async function disconnectGoPro() {
    		addMessage('info', 'Disconnecting from GoPro...');
    		const result = await apiCall('/disconnect', 'POST');

    		if (result.success) {
    			addMessage('success', 'Disconnected successfully');
    		} else {
    			addMessage('error', `Disconnect failed: ${result.message}`);
    		}
    	}

    	// Start recording
    	async function startRecording() {
    		addMessage('info', 'Starting recording...');
    		const result = await apiCall('/start-recording', 'POST');

    		if (!result.success) {
    			addMessage('error', `Failed to start recording: ${result.message}`);
    		}
    	}

    	// Stop recording
    	async function stopRecording() {
    		addMessage('info', 'Stopping recording...');
    		const result = await apiCall('/stop-recording', 'POST');

    		if (!result.success) {
    			addMessage('error', `Failed to stop recording: ${result.message}`);
    		}
    	}

    	// Download latest video
    	async function downloadLatest() {
    		addMessage('info', 'Downloading latest video...');
    		const result = await apiCall('/download-latest', 'POST');

    		if (result.success) {
    			addMessage('success', `Downloaded: ${result.filename}`);
    		} else {
    			addMessage('error', `Download failed: ${result.message}`);
    		}
    	}

    	// Configure camera settings
    	async function configureSettings() {
    		addMessage('info', 'Configuring camera settings...');
    		const result = await apiCall('/configure-settings', 'POST');

    		if (result.success) {
    			addMessage('success', 'Camera settings configured');
    		} else {
    			addMessage('warning', `Settings warning: ${result.message}`);
    		}
    	}

    	// Auto-connect to known device
    	async function autoConnect() {
    		$$invalidate(2, connecting = true);
    		addMessage('info', 'Auto-connecting to known device...');
    		const result = await apiCall('/auto-connect', 'POST');
    		$$invalidate(2, connecting = false);

    		if (result.success) {
    			addMessage('success', result.message);
    		} else {
    			addMessage('warning', result.message);
    		}
    	}

    	// Check for saved device on startup
    	async function checkSavedDevice() {
    		try {
    			const result = await apiCall('/device-status');

    			if (result.success) {
    				$$invalidate(7, savedDevice = result.saved_device);
    				$$invalidate(8, autoReconnectEnabled = result.auto_reconnect_enabled);

    				if (savedDevice) {
    					addMessage('info', `Found saved device: ${savedDevice.model} (${savedDevice.serial})`);
    				}
    			}
    		} catch(error) {
    			
    		} // Silently handle - no saved device is not an error
    	}

    	// Clear saved device
    	async function clearSavedDevice() {
    		if (confirm('Are you sure you want to clear the saved device? You will need to manually connect next time.')) {
    			const result = await apiCall('/clear-device', 'POST');

    			if (result.success) {
    				$$invalidate(7, savedDevice = null);
    				addMessage('success', 'Saved device cleared');
    			} else {
    				addMessage('error', `Failed to clear device: ${result.message}`);
    			}
    		}
    	}

    	// Toggle auto-reconnect
    	async function toggleAutoReconnect() {
    		const newState = !autoReconnectEnabled;
    		const result = await apiCall(`/toggle-auto-reconnect?enabled=${newState}`, 'POST');

    		if (result.success) {
    			$$invalidate(8, autoReconnectEnabled = newState);
    			addMessage('info', `Auto-reconnect ${newState ? 'enabled' : 'disabled'}`);
    		}
    	}

    	// Get current status
    	async function refreshStatus() {
    		const result = await apiCall('/status');

    		if (result) {
    			updateStatus(result);
    		}
    	}

    	// Force reconnect (bypassing cache)
    	async function forceReconnect() {
    		$$invalidate(2, connecting = true);
    		addMessage('info', 'Force reconnecting (fresh discovery)...');
    		const result = await apiCall('/force-reconnect', 'POST');
    		$$invalidate(2, connecting = false);

    		if (result.success) {
    			addMessage('success', result.message);
    		} else {
    			addMessage('error', result.message);
    		}
    	}

    	// WiFi-only reconnect (fastest and most stable)
    	async function wifiOnlyConnect() {
    		$$invalidate(2, connecting = true);
    		addMessage('info', 'Connecting via WiFi with password (most stable)...');
    		const result = await apiCall('/connect', 'POST');
    		$$invalidate(2, connecting = false);

    		if (result.success) {
    			addMessage('success', result.message);
    		} else {
    			addMessage('error', result.message);
    		}
    	}

    	// Lifecycle
    	onMount(() => {
    		connectWebSocket();
    		refreshStatus();
    		checkSavedDevice();
    	});

    	onDestroy(() => {
    		if (ws) {
    			ws.close();
    		}
    	});

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console_1.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({
    		onMount,
    		onDestroy,
    		connected,
    		recording,
    		connecting,
    		cameraInfo,
    		wifiConnected,
    		status,
    		messages,
    		ws,
    		savedDevice,
    		autoReconnectEnabled,
    		API_BASE,
    		WS_URL,
    		addMessage,
    		connectWebSocket,
    		updateStatus,
    		apiCall,
    		connectGoPro,
    		disconnectGoPro,
    		startRecording,
    		stopRecording,
    		downloadLatest,
    		configureSettings,
    		autoConnect,
    		checkSavedDevice,
    		clearSavedDevice,
    		toggleAutoReconnect,
    		refreshStatus,
    		forceReconnect,
    		wifiOnlyConnect
    	});

    	$$self.$inject_state = $$props => {
    		if ('connected' in $$props) $$invalidate(0, connected = $$props.connected);
    		if ('recording' in $$props) $$invalidate(1, recording = $$props.recording);
    		if ('connecting' in $$props) $$invalidate(2, connecting = $$props.connecting);
    		if ('cameraInfo' in $$props) $$invalidate(3, cameraInfo = $$props.cameraInfo);
    		if ('wifiConnected' in $$props) $$invalidate(4, wifiConnected = $$props.wifiConnected);
    		if ('status' in $$props) $$invalidate(5, status = $$props.status);
    		if ('messages' in $$props) $$invalidate(6, messages = $$props.messages);
    		if ('ws' in $$props) ws = $$props.ws;
    		if ('savedDevice' in $$props) $$invalidate(7, savedDevice = $$props.savedDevice);
    		if ('autoReconnectEnabled' in $$props) $$invalidate(8, autoReconnectEnabled = $$props.autoReconnectEnabled);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		connected,
    		recording,
    		connecting,
    		cameraInfo,
    		wifiConnected,
    		status,
    		messages,
    		savedDevice,
    		autoReconnectEnabled,
    		connectGoPro,
    		disconnectGoPro,
    		startRecording,
    		stopRecording,
    		downloadLatest,
    		configureSettings,
    		autoConnect,
    		clearSavedDevice,
    		toggleAutoReconnect,
    		refreshStatus,
    		forceReconnect,
    		wifiOnlyConnect
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		// You can pass props to your app here
    	}
    });

    return app;

})();
//# sourceMappingURL=bundle.js.map
