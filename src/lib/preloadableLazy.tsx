import { createElement, lazy, type ComponentType } from "react";

/**
 * React.lazy that stops suspending once its module has loaded. A plain lazy() component suspends on its first
 * render even when the code is already in memory, and React 19 throttles revealing suspended content by up to
 * 300 ms — so every first open of an app waited a third of a second for nothing. Once `preload()` (or a first
 * render) has resolved the module, this renders the component directly.
 */
export function preloadableLazy<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= factory().then((module) => {
      loaded = module.default;
      return module;
    });
    return pending;
  };
  const Lazy = lazy(preload);
  function Preloadable(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy as unknown as ComponentType<P>, props);
  }
  return Object.assign(Preloadable, { preload });
}
