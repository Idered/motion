import { ref, set, del, unref, watch, computed, reactive, isRef } from 'vue-demi';
import { isObject, useEventListener, noop, useIntersectionObserver, tryOnUnmounted as tryOnUnmounted$1, unrefElement, isNumber, useMediaQuery } from '@vueuse/core';
import { tryOnUnmounted, isFunction } from '@vueuse/shared';
import sync, { getFrameData } from 'framesync';
import { velocityPerSecond, inertia, animate, cubicBezier, linear, easeIn, easeInOut, easeOut, circIn, circInOut, circOut, backIn, backInOut, backOut, anticipate, bounceIn, bounceInOut, bounceOut } from 'popmotion';
import { number, color, px, degrees, scale, alpha, progressPercentage, filter, complex } from 'style-value-types';

const motionState = {};

class SubscriptionManager {
  constructor() {
    this.subscriptions = /* @__PURE__ */ new Set();
  }
  add(handler) {
    this.subscriptions.add(handler);
    return () => this.subscriptions.delete(handler);
  }
  notify(a, b, c) {
    if (!this.subscriptions.size)
      return;
    for (const handler of this.subscriptions)
      handler(a, b, c);
  }
  clear() {
    this.subscriptions.clear();
  }
}

const isFloat = (value) => {
  return !isNaN(parseFloat(value));
};
class MotionValue {
  constructor(init) {
    this.timeDelta = 0;
    this.lastUpdated = 0;
    this.updateSubscribers = new SubscriptionManager();
    this.canTrackVelocity = false;
    this.updateAndNotify = (v) => {
      this.prev = this.current;
      this.current = v;
      const { delta, timestamp } = getFrameData();
      if (this.lastUpdated !== timestamp) {
        this.timeDelta = delta;
        this.lastUpdated = timestamp;
      }
      sync.postRender(this.scheduleVelocityCheck);
      this.updateSubscribers.notify(this.current);
    };
    this.scheduleVelocityCheck = () => sync.postRender(this.velocityCheck);
    this.velocityCheck = ({ timestamp }) => {
      if (!this.canTrackVelocity)
        this.canTrackVelocity = isFloat(this.current);
      if (timestamp !== this.lastUpdated)
        this.prev = this.current;
    };
    this.prev = this.current = init;
    this.canTrackVelocity = isFloat(this.current);
  }
  onChange(subscription) {
    return this.updateSubscribers.add(subscription);
  }
  clearListeners() {
    this.updateSubscribers.clear();
  }
  set(v) {
    this.updateAndNotify(v);
  }
  get() {
    return this.current;
  }
  getPrevious() {
    return this.prev;
  }
  getVelocity() {
    return this.canTrackVelocity ? velocityPerSecond(parseFloat(this.current) - parseFloat(this.prev), this.timeDelta) : 0;
  }
  start(animation) {
    this.stop();
    return new Promise((resolve) => {
      const { stop } = animation(resolve);
      this.stopAnimation = stop;
    }).then(() => this.clearAnimation());
  }
  stop() {
    if (this.stopAnimation)
      this.stopAnimation();
    this.clearAnimation();
  }
  isAnimating() {
    return !!this.stopAnimation;
  }
  clearAnimation() {
    this.stopAnimation = null;
  }
  destroy() {
    this.updateSubscribers.clear();
    this.stop();
  }
}
function getMotionValue(init) {
  return new MotionValue(init);
}

const { isArray } = Array;
function useMotionValues() {
  const motionValues = ref({});
  const stop = (keys) => {
    const destroyKey = (key) => {
      if (!motionValues.value[key])
        return;
      motionValues.value[key].stop();
      motionValues.value[key].destroy();
      del(motionValues.value, key);
    };
    if (keys) {
      if (isArray(keys)) {
        keys.forEach(destroyKey);
      } else {
        destroyKey(keys);
      }
    } else {
      Object.keys(motionValues.value).forEach(destroyKey);
    }
  };
  const get = (key, from, target) => {
    if (motionValues.value[key])
      return motionValues.value[key];
    const motionValue = getMotionValue(from);
    motionValue.onChange((v) => {
      set(target, key, v);
    });
    set(motionValues.value, key, motionValue);
    return motionValue;
  };
  tryOnUnmounted(stop);
  return {
    motionValues,
    get,
    stop
  };
}

const isKeyframesTarget = (v) => {
  return Array.isArray(v);
};
const underDampedSpring = () => ({
  type: "spring",
  stiffness: 500,
  damping: 25,
  restDelta: 0.5,
  restSpeed: 10
});
const criticallyDampedSpring = (to) => ({
  type: "spring",
  stiffness: 550,
  damping: to === 0 ? 2 * Math.sqrt(550) : 30,
  restDelta: 0.01,
  restSpeed: 10
});
const overDampedSpring = (to) => ({
  type: "spring",
  stiffness: 550,
  damping: to === 0 ? 100 : 30,
  restDelta: 0.01,
  restSpeed: 10
});
const linearTween = () => ({
  type: "keyframes",
  ease: "linear",
  duration: 300
});
const keyframes = (values) => ({
  type: "keyframes",
  duration: 800,
  values
});
const defaultTransitions = {
  default: overDampedSpring,
  x: underDampedSpring,
  y: underDampedSpring,
  z: underDampedSpring,
  rotate: underDampedSpring,
  rotateX: underDampedSpring,
  rotateY: underDampedSpring,
  rotateZ: underDampedSpring,
  scaleX: criticallyDampedSpring,
  scaleY: criticallyDampedSpring,
  scale: criticallyDampedSpring,
  backgroundColor: linearTween,
  color: linearTween,
  opacity: linearTween
};
const getDefaultTransition = (valueKey, to) => {
  let transitionFactory;
  if (isKeyframesTarget(to)) {
    transitionFactory = keyframes;
  } else {
    transitionFactory = defaultTransitions[valueKey] || defaultTransitions.default;
  }
  return { to, ...transitionFactory(to) };
};

const int = {
  ...number,
  transform: Math.round
};
const valueTypes = {
  color,
  backgroundColor: color,
  outlineColor: color,
  fill: color,
  stroke: color,
  borderColor: color,
  borderTopColor: color,
  borderRightColor: color,
  borderBottomColor: color,
  borderLeftColor: color,
  borderWidth: px,
  borderTopWidth: px,
  borderRightWidth: px,
  borderBottomWidth: px,
  borderLeftWidth: px,
  borderRadius: px,
  radius: px,
  borderTopLeftRadius: px,
  borderTopRightRadius: px,
  borderBottomRightRadius: px,
  borderBottomLeftRadius: px,
  width: px,
  maxWidth: px,
  height: px,
  maxHeight: px,
  size: px,
  top: px,
  right: px,
  bottom: px,
  left: px,
  padding: px,
  paddingTop: px,
  paddingRight: px,
  paddingBottom: px,
  paddingLeft: px,
  margin: px,
  marginTop: px,
  marginRight: px,
  marginBottom: px,
  marginLeft: px,
  rotate: degrees,
  rotateX: degrees,
  rotateY: degrees,
  rotateZ: degrees,
  scale,
  scaleX: scale,
  scaleY: scale,
  scaleZ: scale,
  skew: degrees,
  skewX: degrees,
  skewY: degrees,
  distance: px,
  translateX: px,
  translateY: px,
  translateZ: px,
  x: px,
  y: px,
  z: px,
  perspective: px,
  transformPerspective: px,
  opacity: alpha,
  originX: progressPercentage,
  originY: progressPercentage,
  originZ: px,
  zIndex: int,
  filter,
  WebkitFilter: filter,
  fillOpacity: alpha,
  strokeOpacity: alpha,
  numOctaves: int
};
const getValueType = (key) => valueTypes[key];
const getValueAsType = (value, type) => {
  return type && typeof value === "number" && type.transform ? type.transform(value) : value;
};
function getAnimatableNone(key, value) {
  let defaultValueType = getValueType(key);
  if (defaultValueType !== filter)
    defaultValueType = complex;
  return defaultValueType.getAnimatableNone ? defaultValueType.getAnimatableNone(value) : void 0;
}

const easingLookup = {
  linear,
  easeIn,
  easeInOut,
  easeOut,
  circIn,
  circInOut,
  circOut,
  backIn,
  backInOut,
  backOut,
  anticipate,
  bounceIn,
  bounceInOut,
  bounceOut
};
const easingDefinitionToFunction = (definition) => {
  if (Array.isArray(definition)) {
    const [x1, y1, x2, y2] = definition;
    return cubicBezier(x1, y1, x2, y2);
  } else if (typeof definition === "string") {
    return easingLookup[definition];
  }
  return definition;
};
const isEasingArray = (ease) => {
  return Array.isArray(ease) && typeof ease[0] !== "number";
};
const isAnimatable = (key, value) => {
  if (key === "zIndex")
    return false;
  if (typeof value === "number" || Array.isArray(value))
    return true;
  if (typeof value === "string" && complex.test(value) && !value.startsWith("url("))
    return true;
  return false;
};
function hydrateKeyframes(options) {
  if (Array.isArray(options.to) && options.to[0] === null) {
    options.to = [...options.to];
    options.to[0] = options.from;
  }
  return options;
}
function convertTransitionToAnimationOptions({
  ease,
  times,
  delay,
  ...transition
}) {
  const options = { ...transition };
  if (times)
    options.offset = times;
  if (ease) {
    options.ease = isEasingArray(ease) ? ease.map(easingDefinitionToFunction) : easingDefinitionToFunction(ease);
  }
  if (delay)
    options.elapsed = -delay;
  return options;
}
function getPopmotionAnimationOptions(transition, options, key) {
  if (Array.isArray(options.to)) {
    if (!transition.duration)
      transition.duration = 800;
  }
  hydrateKeyframes(options);
  if (!isTransitionDefined(transition)) {
    transition = {
      ...transition,
      ...getDefaultTransition(key, options.to)
    };
  }
  return {
    ...options,
    ...convertTransitionToAnimationOptions(transition)
  };
}
function isTransitionDefined({
  delay,
  repeat,
  repeatType,
  repeatDelay,
  from,
  ...transition
}) {
  return !!Object.keys(transition).length;
}
function getValueTransition(transition, key) {
  return transition[key] || transition.default || transition;
}
function getAnimation(key, value, target, transition, onComplete) {
  const valueTransition = getValueTransition(transition, key);
  let origin = valueTransition.from === null || valueTransition.from === void 0 ? value.get() : valueTransition.from;
  const isTargetAnimatable = isAnimatable(key, target);
  if (origin === "none" && isTargetAnimatable && typeof target === "string")
    origin = getAnimatableNone(key, target);
  const isOriginAnimatable = isAnimatable(key, origin);
  function start(complete) {
    const options = {
      from: origin,
      to: target,
      velocity: transition.velocity ? transition.velocity : value.getVelocity(),
      onUpdate: (v) => value.set(v)
    };
    return valueTransition.type === "inertia" || valueTransition.type === "decay" ? inertia({ ...options, ...valueTransition }) : animate({
      ...getPopmotionAnimationOptions(valueTransition, options, key),
      onUpdate: (v) => {
        options.onUpdate(v);
        if (valueTransition.onUpdate)
          valueTransition.onUpdate(v);
      },
      onComplete: () => {
        if (transition.onComplete)
          transition.onComplete();
        if (onComplete)
          onComplete();
        if (complete)
          complete();
      }
    });
  }
  function set(complete) {
    value.set(target);
    if (transition.onComplete)
      transition.onComplete();
    if (onComplete)
      onComplete();
    if (complete)
      complete();
    return { stop: () => {
    } };
  }
  return !isOriginAnimatable || !isTargetAnimatable || valueTransition.type === false ? set : start;
}

function useMotionTransitions() {
  const { motionValues, stop, get } = useMotionValues();
  const push = (key, value, target, transition = {}, onComplete) => {
    const from = target[key];
    const motionValue = get(key, from, target);
    if (transition && transition.immediate) {
      motionValue.set(value);
      return;
    }
    const animation = getAnimation(key, motionValue, value, transition, onComplete);
    motionValue.start(animation);
  };
  return { motionValues, stop, push };
}

function useMotionControls(motionProperties, variants = {}, { motionValues, push, stop } = useMotionTransitions()) {
  const _variants = unref(variants);
  const isAnimating = ref(false);
  const _stopWatchAnimating = watch(motionValues, (newVal) => {
    isAnimating.value = Object.values(newVal).filter((value) => value.isAnimating()).length > 0;
  }, {
    immediate: true,
    deep: true
  });
  const getVariantFromKey = (variant) => {
    if (!_variants || !_variants[variant])
      throw new Error(`The variant ${variant} does not exist.`);
    return _variants[variant];
  };
  const apply = (variant) => {
    if (typeof variant === "string")
      variant = getVariantFromKey(variant);
    return Promise.all(Object.entries(variant).map(([key, value]) => {
      if (key === "transition")
        return void 0;
      return new Promise((resolve) => {
        push(key, value, motionProperties, variant.transition || getDefaultTransition(key, variant[key]), resolve);
      });
    }).filter(Boolean));
  };
  const set = (variant) => {
    const variantData = isObject(variant) ? variant : getVariantFromKey(variant);
    Object.entries(variantData).forEach(([key, value]) => {
      if (key === "transition")
        return;
      push(key, value, motionProperties, {
        immediate: true
      });
    });
  };
  const leave = async (done) => {
    let leaveVariant;
    if (_variants) {
      if (_variants.leave)
        leaveVariant = _variants.leave;
      if (!_variants.leave && _variants.initial)
        leaveVariant = _variants.initial;
    }
    if (!leaveVariant) {
      done();
      return;
    }
    await apply(leaveVariant);
    done();
  };
  return {
    isAnimating,
    apply,
    set,
    stopTransitions: () => {
      _stopWatchAnimating();
      stop();
    },
    leave
  };
}

const isBrowser = typeof window !== "undefined";
const supportsPointerEvents = () => isBrowser && window.onpointerdown === null;
const supportsTouchEvents = () => isBrowser && window.ontouchstart === null;
const supportsMouseEvents = () => isBrowser && window.onmousedown === null;

function registerEventListeners({
  target,
  state,
  variants,
  apply
}) {
  const _variants = unref(variants);
  const _eventListeners = [];
  const _useEventListener = (...args) => {
    const _stop = useEventListener.apply(null, args);
    _eventListeners.push(_stop);
    return _stop;
  };
  const hovered = ref(false);
  const tapped = ref(false);
  const focused = ref(false);
  const mutableKeys = computed(() => {
    let result = [];
    if (!_variants)
      return result;
    if (_variants.hovered)
      result = [...result, ...Object.keys(_variants.hovered)];
    if (_variants.tapped)
      result = [...result, ...Object.keys(_variants.tapped)];
    if (_variants.focused)
      result = [...result, ...Object.keys(_variants.focused)];
    return result;
  });
  const computedProperties = computed(() => {
    const result = {};
    Object.assign(result, state.value);
    if (hovered.value && _variants.hovered)
      Object.assign(result, _variants.hovered);
    if (tapped.value && _variants.tapped)
      Object.assign(result, _variants.tapped);
    if (focused.value && _variants.focused)
      Object.assign(result, _variants.focused);
    for (const key in result)
      if (!mutableKeys.value.includes(key))
        delete result[key];
    return result;
  });
  if (_variants.hovered) {
    _useEventListener(target, "mouseenter", () => {
      hovered.value = true;
    });
    _useEventListener(target, "mouseleave", () => {
      hovered.value = false;
      tapped.value = false;
    });
    _useEventListener(target, "mouseout", () => {
      hovered.value = false;
      tapped.value = false;
    });
  }
  if (_variants.tapped) {
    if (supportsMouseEvents()) {
      _useEventListener(target, "mousedown", () => {
        tapped.value = true;
      });
      _useEventListener(target, "mouseup", () => {
        tapped.value = false;
      });
    }
    if (supportsPointerEvents()) {
      _useEventListener(target, "pointerdown", () => {
        tapped.value = true;
      });
      _useEventListener(target, "pointerup", () => {
        tapped.value = false;
      });
    }
    if (supportsTouchEvents()) {
      _useEventListener(target, "touchstart", () => {
        tapped.value = true;
      });
      _useEventListener(target, "touchend", () => {
        tapped.value = false;
      });
    }
  }
  if (_variants.focused) {
    _useEventListener(target, "focus", () => {
      focused.value = true;
    });
    _useEventListener(target, "blur", () => {
      focused.value = false;
    });
  }
  const _stopSync = watch(computedProperties, apply);
  const stop = () => {
    _eventListeners.forEach((stopFn) => stopFn());
    _stopSync();
  };
  return { stop };
}

function registerLifeCycleHooks({
  set,
  target,
  variants,
  variant
}) {
  const _variants = unref(variants);
  const stop = watch(() => target, () => {
    if (!_variants)
      return;
    if (_variants.initial)
      set("initial");
    if (_variants.enter)
      variant.value = "enter";
  }, {
    immediate: true,
    flush: "pre"
  });
  return { stop };
}

function registerVariantsSync({
  state,
  apply
}) {
  const stop = watch(state, (newVal) => {
    if (newVal)
      apply(newVal);
  }, {
    immediate: true
  });
  return { stop };
}

function registerVisibilityHooks({
  target,
  variants,
  variant
}) {
  const _variants = unref(variants);
  let stop = noop;
  if (_variants && _variants.visible) {
    const { stop: stopObserver } = useIntersectionObserver(target, ([{ isIntersecting }]) => {
      if (isIntersecting)
        variant.value = "visible";
      else
        variant.value = "initial";
    });
    stop = stopObserver;
  }
  return {
    stop
  };
}

function useMotionFeatures(instance, options = {
  syncVariants: true,
  lifeCycleHooks: true,
  visibilityHooks: true,
  eventListeners: true
}) {
  const toStop = ref([]);
  if (options.lifeCycleHooks) {
    const { stop: stopLifeCycleHooks } = registerLifeCycleHooks(instance);
    toStop.value.push(stopLifeCycleHooks);
  }
  if (options.syncVariants) {
    const { stop: stopVariantSync } = registerVariantsSync(instance);
    toStop.value.push(stopVariantSync);
  }
  if (options.visibilityHooks) {
    const { stop: stopVisibilityHooks } = registerVisibilityHooks(instance);
    toStop.value.push(stopVisibilityHooks);
  }
  if (options.eventListeners) {
    const { stop: stopEventListeners } = registerEventListeners(instance);
    toStop.value.push(stopEventListeners);
  }
  const stop = () => toStop.value.forEach((_stop) => _stop());
  tryOnUnmounted$1(stop);
  return { stop };
}

function reactiveStyle(props = {}) {
  const state = reactive({
    ...props
  });
  const style = ref({});
  watch(state, () => {
    const result = {};
    for (const [key, value] of Object.entries(state)) {
      const valueType = getValueType(key);
      const valueAsType = getValueAsType(value, valueType);
      result[key] = valueAsType;
    }
    style.value = result;
  }, {
    immediate: true,
    deep: true
  });
  return {
    state,
    style
  };
}

const transformAxes = ["", "X", "Y", "Z"];
const order = ["perspective", "translate", "scale", "rotate", "skew"];
const transformProps = ["transformPerspective", "x", "y", "z"];
order.forEach((operationKey) => {
  transformAxes.forEach((axesKey) => {
    const key = operationKey + axesKey;
    transformProps.push(key);
  });
});
const transformPropSet = new Set(transformProps);
function isTransformProp(key) {
  return transformPropSet.has(key);
}
const transformOriginProps = /* @__PURE__ */ new Set(["originX", "originY", "originZ"]);
function isTransformOriginProp(key) {
  return transformOriginProps.has(key);
}
function splitValues(variant) {
  const transform = {};
  const style = {};
  Object.entries(variant).forEach(([key, value]) => {
    if (isTransformProp(key) || isTransformOriginProp(key))
      transform[key] = value;
    else
      style[key] = value;
  });
  return { transform, style };
}

function useElementStyle(target, onInit) {
  let _cache;
  let _target;
  const { state, style } = reactiveStyle();
  const stopInitWatch = watch(() => unrefElement(target), (el) => {
    if (!el)
      return;
    _target = el;
    for (const key of Object.keys(valueTypes)) {
      if (el.style[key] === null || el.style[key] === "" || isTransformProp(key) || isTransformOriginProp(key))
        continue;
      set(state, key, el.style[key]);
    }
    if (_cache) {
      Object.entries(_cache).forEach(([key, value]) => set(el.style, key, value));
    }
    if (onInit)
      onInit(state);
  }, {
    immediate: true
  });
  const stopSyncWatch = watch(style, (newVal) => {
    if (!_target) {
      _cache = newVal;
      return;
    }
    for (const key in newVal)
      set(_target.style, key, newVal[key]);
  }, {
    immediate: true
  });
  const stop = () => {
    _target = void 0;
    _cache = void 0;
    stopInitWatch();
    stopSyncWatch();
  };
  return {
    style: state,
    stop
  };
}

const translateAlias = {
  x: "translateX",
  y: "translateY",
  z: "translateZ"
};
function reactiveTransform(props = {}, enableHardwareAcceleration = true) {
  const state = reactive({ ...props });
  const transform = ref("");
  watch(state, (newVal) => {
    let result = "";
    let hasHardwareAcceleration = false;
    if (enableHardwareAcceleration && (newVal.x || newVal.y || newVal.z)) {
      const str = [newVal.x || 0, newVal.y || 0, newVal.z || 0].map(px.transform).join(",");
      result += `translate3d(${str}) `;
      hasHardwareAcceleration = true;
    }
    for (const [key, value] of Object.entries(newVal)) {
      if (enableHardwareAcceleration && (key === "x" || key === "y" || key === "z"))
        continue;
      const valueType = getValueType(key);
      const valueAsType = getValueAsType(value, valueType);
      result += `${translateAlias[key] || key}(${valueAsType}) `;
    }
    if (enableHardwareAcceleration && !hasHardwareAcceleration)
      result += "translateZ(0px) ";
    transform.value = result.trim();
  }, {
    immediate: true,
    deep: true
  });
  return {
    state,
    transform
  };
}

function parseTransform(transform) {
  const transforms = transform.trim().split(/\) |\)/);
  if (transforms.length === 1)
    return {};
  const parseValues = (value) => {
    if (value.endsWith("px") || value.endsWith("deg"))
      return parseFloat(value);
    if (isNaN(Number(value)))
      return Number(value);
    return value;
  };
  return transforms.reduce((acc, transform2) => {
    if (!transform2)
      return acc;
    const [name, transformValue] = transform2.split("(");
    const valueArray = transformValue.split(",");
    const values = valueArray.map((val) => {
      return parseValues(val.endsWith(")") ? val.replace(")", "") : val.trim());
    });
    const value = values.length === 1 ? values[0] : values;
    return {
      ...acc,
      [name]: value
    };
  }, {});
}
function stateFromTransform(state, transform) {
  Object.entries(parseTransform(transform)).forEach(([key, value]) => {
    value = parseFloat(value);
    const axes = ["x", "y", "z"];
    if (key === "translate3d") {
      if (value === 0) {
        axes.forEach((axis) => {
          set(state, axis, 0);
        });
        return;
      }
      value.forEach((axisValue, index) => {
        set(state, axes[index], axisValue);
      });
      return;
    }
    if (key === "translateX") {
      set(state, "x", value);
      return;
    }
    if (key === "translateY") {
      set(state, "y", value);
      return;
    }
    if (key === "translateZ") {
      set(state, "z", value);
      return;
    }
    set(state, key, value);
  });
}

function useElementTransform(target, onInit) {
  let _cache;
  let _target;
  const { state, transform } = reactiveTransform();
  const stopInitWatch = watch(() => unrefElement(target), (el) => {
    if (!el)
      return;
    _target = el;
    if (el.style.transform)
      stateFromTransform(state, el.style.transform);
    if (_cache)
      el.style.transform = _cache;
    if (onInit)
      onInit(state);
  }, {
    immediate: true
  });
  const stopSyncWatch = watch(transform, (newValue) => {
    if (!_target) {
      _cache = newValue;
      return;
    }
    _target.style.transform = newValue;
  }, {
    immediate: true
  });
  const stop = () => {
    _cache = void 0;
    _target = void 0;
    stopInitWatch();
    stopSyncWatch();
  };
  return {
    transform: state,
    stop
  };
}

function useMotionProperties(target, defaultValues) {
  const motionProperties = reactive({});
  const apply = (values) => {
    Object.entries(values).forEach(([key, value]) => {
      set(motionProperties, key, value);
    });
  };
  const { style, stop: stopStyleWatchers } = useElementStyle(target, apply);
  const { transform, stop: stopTransformWatchers } = useElementTransform(target, apply);
  const stopPropertiesWatch = watch(motionProperties, (newVal) => {
    Object.entries(newVal).forEach(([key, value]) => {
      const target2 = isTransformProp(key) ? transform : style;
      if (target2[key] && target2[key] === value)
        return;
      set(target2, key, value);
    });
  }, {
    immediate: true,
    deep: true
  });
  const stopInitWatch = watch(() => unrefElement(target), (el) => {
    if (!el)
      return;
    if (defaultValues)
      apply(defaultValues);
  }, {
    immediate: true
  });
  const stop = () => {
    stopStyleWatchers();
    stopTransformWatchers();
    stopPropertiesWatch();
    stopInitWatch();
  };
  return {
    motionProperties,
    style,
    transform,
    stop
  };
}

function useMotionVariants(variants = {}) {
  const _variants = unref(variants);
  const variant = ref();
  const state = computed(() => {
    if (!variant.value)
      return;
    return _variants[variant.value];
  });
  return {
    state,
    variant
  };
}

function useMotion(target, variants = {}, options) {
  const { motionProperties, stop: stopMotionProperties } = useMotionProperties(target);
  const { variant, state } = useMotionVariants(variants);
  const controls = useMotionControls(motionProperties, variants);
  const instance = {
    target,
    variant,
    variants,
    state,
    motionProperties,
    ...controls,
    stop: (force = false) => {
    }
  };
  const { stop: stopMotionFeatures } = useMotionFeatures(instance, options);
  instance.stop = (force = false) => {
    const _stop = () => {
      instance.stopTransitions();
      stopMotionProperties();
      stopMotionFeatures();
    };
    if (!force && variants.value && variants.value.leave) {
      const _stopWatch = watch(instance.isAnimating, (newVal) => {
        if (!newVal) {
          _stopWatch();
          _stop();
        }
      });
    } else {
      _stop();
    }
  };
  tryOnUnmounted$1(() => instance.stop());
  return instance;
}

const directivePropsKeys = [
  "initial",
  "enter",
  "leave",
  "visible",
  "hovered",
  "tapped",
  "focused",
  "delay"
];
const resolveVariants = (node, variantsRef) => {
  const target = node.props ? node.props : node.data && node.data.attrs ? node.data.attrs : {};
  if (target) {
    if (target.variants && isObject(target.variants)) {
      variantsRef.value = {
        ...variantsRef.value,
        ...target.variants
      };
    }
    directivePropsKeys.forEach((key) => {
      if (key === "delay") {
        if (target && target[key] && isNumber(target[key])) {
          const delay = target[key];
          if (variantsRef && variantsRef.value) {
            if (variantsRef.value.enter) {
              if (!variantsRef.value.enter.transition)
                variantsRef.value.enter.transition = {};
              variantsRef.value.enter.transition = {
                ...variantsRef.value.enter.transition,
                delay
              };
            }
            if (variantsRef.value.visible) {
              if (!variantsRef.value.visible.transition)
                variantsRef.value.visible.transition = {};
              variantsRef.value.visible.transition = {
                ...variantsRef.value.visible.transition,
                delay
              };
            }
          }
        }
        return;
      }
      if (target && target[key] && isObject(target[key]))
        variantsRef.value[key] = target[key];
    });
  }
};

const directive = (variants) => {
  const register = (el, binding, node) => {
    const key = binding.value && typeof binding.value === "string" ? binding.value : node.key;
    if (key && motionState[key])
      motionState[key].stop();
    const variantsRef = ref(variants || {});
    if (typeof binding.value === "object")
      variantsRef.value = binding.value;
    resolveVariants(node, variantsRef);
    const motionInstance = useMotion(el, variantsRef);
    el.motionInstance = motionInstance;
    if (key)
      set(motionState, key, motionInstance);
  };
  const unregister = (el) => {
    if (el.motionInstance)
      el.motionInstance.stop();
  };
  return {
    created: register,
    unmounted: unregister,
    bind: register,
    unbind: unregister,
    getSSRProps(binding, node) {
      const { initial } = binding.value || node?.props || {};
      if (!initial || Object.keys(initial).length === 0)
        return {};
      const { transform: _transform, style: _style } = splitValues(initial);
      const { transform } = reactiveTransform(_transform);
      const { style } = reactiveStyle(_style);
      if (transform.value)
        style.value.transform = transform.value;
      return {
        style: style.value
      };
    }
  };
};

const fade = {
  initial: {
    opacity: 0
  },
  enter: {
    opacity: 1
  }
};
const fadeVisible = {
  initial: {
    opacity: 0
  },
  visible: {
    opacity: 1
  }
};

const pop = {
  initial: {
    scale: 0,
    opacity: 0
  },
  enter: {
    scale: 1,
    opacity: 1
  }
};
const popVisible = {
  initial: {
    scale: 0,
    opacity: 0
  },
  visible: {
    scale: 1,
    opacity: 1
  }
};

const rollLeft = {
  initial: {
    x: -100,
    rotate: 90,
    opacity: 0
  },
  enter: {
    x: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollVisibleLeft = {
  initial: {
    x: -100,
    rotate: 90,
    opacity: 0
  },
  visible: {
    x: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollRight = {
  initial: {
    x: 100,
    rotate: -90,
    opacity: 0
  },
  enter: {
    x: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollVisibleRight = {
  initial: {
    x: 100,
    rotate: -90,
    opacity: 0
  },
  visible: {
    x: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollTop = {
  initial: {
    y: -100,
    rotate: -90,
    opacity: 0
  },
  enter: {
    y: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollVisibleTop = {
  initial: {
    y: -100,
    rotate: -90,
    opacity: 0
  },
  visible: {
    y: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollBottom = {
  initial: {
    y: 100,
    rotate: 90,
    opacity: 0
  },
  enter: {
    y: 0,
    rotate: 0,
    opacity: 1
  }
};
const rollVisibleBottom = {
  initial: {
    y: 100,
    rotate: 90,
    opacity: 0
  },
  visible: {
    y: 0,
    rotate: 0,
    opacity: 1
  }
};

const slideLeft = {
  initial: {
    x: -100,
    opacity: 0
  },
  enter: {
    x: 0,
    opacity: 1
  }
};
const slideVisibleLeft = {
  initial: {
    x: -100,
    opacity: 0
  },
  visible: {
    x: 0,
    opacity: 1
  }
};
const slideRight = {
  initial: {
    x: 100,
    opacity: 0
  },
  enter: {
    x: 0,
    opacity: 1
  }
};
const slideVisibleRight = {
  initial: {
    x: 100,
    opacity: 0
  },
  visible: {
    x: 0,
    opacity: 1
  }
};
const slideTop = {
  initial: {
    y: -100,
    opacity: 0
  },
  enter: {
    y: 0,
    opacity: 1
  }
};
const slideVisibleTop = {
  initial: {
    y: -100,
    opacity: 0
  },
  visible: {
    y: 0,
    opacity: 1
  }
};
const slideBottom = {
  initial: {
    y: 100,
    opacity: 0
  },
  enter: {
    y: 0,
    opacity: 1
  }
};
const slideVisibleBottom = {
  initial: {
    y: 100,
    opacity: 0
  },
  visible: {
    y: 0,
    opacity: 1
  }
};

const presets = {
  __proto__: null,
  fade: fade,
  fadeVisible: fadeVisible,
  pop: pop,
  popVisible: popVisible,
  rollBottom: rollBottom,
  rollLeft: rollLeft,
  rollRight: rollRight,
  rollTop: rollTop,
  rollVisibleBottom: rollVisibleBottom,
  rollVisibleLeft: rollVisibleLeft,
  rollVisibleRight: rollVisibleRight,
  rollVisibleTop: rollVisibleTop,
  slideBottom: slideBottom,
  slideLeft: slideLeft,
  slideRight: slideRight,
  slideTop: slideTop,
  slideVisibleBottom: slideVisibleBottom,
  slideVisibleLeft: slideVisibleLeft,
  slideVisibleRight: slideVisibleRight,
  slideVisibleTop: slideVisibleTop
};

function slugify(string) {
  const a = "\xE0\xE1\xE2\xE4\xE6\xE3\xE5\u0101\u0103\u0105\xE7\u0107\u010D\u0111\u010F\xE8\xE9\xEA\xEB\u0113\u0117\u0119\u011B\u011F\u01F5\u1E27\xEE\xEF\xED\u012B\u012F\xEC\u0142\u1E3F\xF1\u0144\u01F9\u0148\xF4\xF6\xF2\xF3\u0153\xF8\u014D\xF5\u0151\u1E55\u0155\u0159\xDF\u015B\u0161\u015F\u0219\u0165\u021B\xFB\xFC\xF9\xFA\u016B\u01D8\u016F\u0171\u0173\u1E83\u1E8D\xFF\xFD\u017E\u017A\u017C\xB7/_,:;";
  const b = "aaaaaaaaaacccddeeeeeeeegghiiiiiilmnnnnoooooooooprrsssssttuuuuuuuuuwxyyzzz------";
  const p = new RegExp(a.split("").join("|"), "g");
  return string.toString().replace(/[A-Z]/g, (s) => `-${s}`).toLowerCase().replace(/\s+/g, "-").replace(p, (c) => b.charAt(a.indexOf(c))).replace(/&/g, "-and-").replace(/[^\w\-]+/g, "").replace(/\-\-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

const MotionPlugin = {
  install(app, options) {
    app.directive("motion", directive());
    if (!options || options && !options.excludePresets) {
      for (const key in presets) {
        const preset = presets[key];
        app.directive(`motion-${slugify(key)}`, directive(preset));
      }
    }
    if (options && options.directives) {
      for (const key in options.directives) {
        const variants = options.directives[key];
        if (!variants.initial && __DEV__) {
          console.warn(`Your directive v-motion-${key} is missing initial variant!`);
        }
        app.directive(`motion-${key}`, directive(variants));
      }
    }
  }
};

function useMotions() {
  return motionState;
}

function useSpring(values, spring) {
  const { stop, get } = useMotionValues();
  return {
    values,
    stop,
    set: (properties) => Promise.all(Object.entries(properties).map(([key, value]) => {
      const motionValue = get(key, values[key], values);
      return motionValue.start((onComplete) => {
        const options = {
          type: "spring",
          ...spring || getDefaultTransition(key, value)
        };
        return animate({
          from: motionValue.get(),
          to: value,
          velocity: motionValue.getVelocity(),
          onUpdate: (v) => motionValue.set(v),
          onComplete,
          ...options
        });
      });
    }))
  };
}

function isMotionInstance(obj) {
  const _obj = obj;
  return _obj.apply !== void 0 && isFunction(_obj.apply) && _obj.set !== void 0 && isFunction(_obj.set) && _obj.stopTransitions !== void 0 && isFunction(_obj.stopTransitions) && _obj.target !== void 0 && isRef(_obj.target);
}

function useReducedMotion(options = {}) {
  return useMediaQuery("(prefers-reduced-motion: reduce)", options);
}

export { directive as MotionDirective, MotionPlugin, fade, fadeVisible, isMotionInstance, pop, popVisible, reactiveStyle, reactiveTransform, rollBottom, rollLeft, rollRight, rollTop, rollVisibleBottom, rollVisibleLeft, rollVisibleRight, rollVisibleTop, slideBottom, slideLeft, slideRight, slideTop, slideVisibleBottom, slideVisibleLeft, slideVisibleRight, slideVisibleTop, slugify, useElementStyle, useElementTransform, useMotion, useMotionControls, useMotionProperties, useMotionTransitions, useMotionVariants, useMotions, useReducedMotion, useSpring };
