/*
 * Copyright (C) 2008 Apple Inc. All Rights Reserved.
 * Copyright (C) 2011 Google Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class Widget extends Common.Object {
  /**
   * @param {boolean=} isWebComponent
   * @param {boolean=} delegatesFocus
   */
  constructor(isWebComponent, delegatesFocus) {
    super();
    this.contentElement = createElementWithClass('div', 'widget');
    if (isWebComponent) {
      this.element = createElementWithClass('div', 'vbox flex-auto');
      this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, undefined, delegatesFocus);
      this._shadowRoot.appendChild(this.contentElement);
    } else {
      this.element = this.contentElement;
    }
    this._isWebComponent = isWebComponent;
    this.element.__widget = this;
    this._visible = false;
    this._isRoot = false;
    this._isShowing = false;
    this._children = [];
    this._hideOnDetach = false;
    this._notificationDepth = 0;
    this._invalidationsSuspended = 0;
    this._defaultFocusedChild = null;
  }

  static _incrementWidgetCounter(parentElement, childElement) {
    const count = (childElement.__widgetCounter || 0) + (childElement.__widget ? 1 : 0);
    if (!count) {
      return;
    }

    while (parentElement) {
      parentElement.__widgetCounter = (parentElement.__widgetCounter || 0) + count;
      parentElement = parentElement.parentElementOrShadowHost();
    }
  }

  static _decrementWidgetCounter(parentElement, childElement) {
    const count = (childElement.__widgetCounter || 0) + (childElement.__widget ? 1 : 0);
    if (!count) {
      return;
    }

    while (parentElement) {
      parentElement.__widgetCounter -= count;
      parentElement = parentElement.parentElementOrShadowHost();
    }
  }

  static __assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  /**
   * @param {?Node} node
   */
  static focusWidgetForNode(node) {
    while (node) {
      if (node.__widget) {
        break;
      }
      node = node.parentNodeOrShadowHost();
    }
    if (!node) {
      return;
    }

    let widget = node.__widget;
    while (widget._parentWidget) {
      widget._parentWidget._defaultFocusedChild = widget;
      widget = widget._parentWidget;
    }
  }

  markAsRoot() {
    Widget.__assert(!this.element.parentElement, 'Attempt to mark as root attached node');
    this._isRoot = true;
  }

  /**
   * @return {?Widget}
   */
  parentWidget() {
    return this._parentWidget;
  }

  /**
   * @return {!Array.<!Widget>}
   */
  children() {
    return this._children;
  }

  /**
   * @param {!Widget} widget
   * @protected
   */
  childWasDetached(widget) {
  }

  /**
   * @return {boolean}
   */
  isShowing() {
    return this._isShowing;
  }

  /**
   * @return {boolean}
   */
  shouldHideOnDetach() {
    if (!this.element.parentElement) {
      return false;
    }
    if (this._hideOnDetach) {
      return true;
    }
    for (const child of this._children) {
      if (child.shouldHideOnDetach()) {
        return true;
      }
    }
    return false;
  }

  setHideOnDetach() {
    this._hideOnDetach = true;
  }

  /**
   * @return {boolean}
   */
  _inNotification() {
    return !!this._notificationDepth || (this._parentWidget && this._parentWidget._inNotification());
  }

  _parentIsShowing() {
    if (this._isRoot) {
      return true;
    }
    return !!this._parentWidget && this._parentWidget.isShowing();
  }

  /**
   * @param {function(this:Widget)} method
   */
  _callOnVisibleChildren(method) {
    const copy = this._children.slice();
    for (let i = 0; i < copy.length; ++i) {
      if (copy[i]._parentWidget === this && copy[i]._visible) {
        method.call(copy[i]);
      }
    }
  }

  _processWillShow() {
    this._callOnVisibleChildren(this._processWillShow);
    this._isShowing = true;
  }

  _processWasShown() {
    if (this._inNotification()) {
      return;
    }
    this.restoreScrollPositions();
    this._notify(this.wasShown);
    this._callOnVisibleChildren(this._processWasShown);
  }

  _processWillHide() {
    if (this._inNotification()) {
      return;
    }
    this.storeScrollPositions();

    this._callOnVisibleChildren(this._processWillHide);
    this._notify(this.willHide);
    this._isShowing = false;
  }

  _processWasHidden() {
    this._callOnVisibleChildren(this._processWasHidden);
  }

  _processOnResize() {
    if (this._inNotification()) {
      return;
    }
    if (!this.isShowing()) {
      return;
    }
    this._notify(this.onResize);
    this._callOnVisibleChildren(this._processOnResize);
  }

  /**
   * @param {function(this:Widget)} notification
   */
  _notify(notification) {
    ++this._notificationDepth;
    try {
      notification.call(this);
    } finally {
      --this._notificationDepth;
    }
  }

  wasShown() {
  }

  willHide() {
  }

  onResize() {
  }

  onLayout() {
  }

  ownerViewDisposed() {
  }

  /**
   * @param {!Element} parentElement
   * @param {?Node=} insertBefore
   */
  show(parentElement, insertBefore) {
    Widget.__assert(parentElement, 'Attempt to attach widget with no parent element');

    if (!this._isRoot) {
      // Update widget hierarchy.
      let currentParent = parentElement;
      while (currentParent && !currentParent.__widget) {
        currentParent = currentParent.parentElementOrShadowHost();
      }
      Widget.__assert(currentParent, 'Attempt to attach widget to orphan node');
      this._attach(currentParent.__widget);
    }

    this._showWidget(parentElement, insertBefore);
  }

  /**
   * @param {!Widget} parentWidget
   */
  _attach(parentWidget) {
    if (parentWidget === this._parentWidget) {
      return;
    }
    if (this._parentWidget) {
      this.detach();
    }
    this._parentWidget = parentWidget;
    this._parentWidget._children.push(this);
    this._isRoot = false;
  }

  showWidget() {
    if (this._visible) {
      return;
    }
    Widget.__assert(this.element.parentElement, 'Attempt to show widget that is not hidden using hideWidget().');
    this._showWidget(/** @type {!Element} */ (this.element.parentElement), this.element.nextSibling);
  }

  /**
   * @param {!Element} parentElement
   * @param {?Node=} insertBefore
   */
  _showWidget(parentElement, insertBefore) {
    let currentParent = parentElement;
    while (currentParent && !currentParent.__widget) {
      currentParent = currentParent.parentElementOrShadowHost();
    }

    if (this._isRoot) {
      Widget.__assert(!currentParent, 'Attempt to show root widget under another widget');
    } else {
      Widget.__assert(
          currentParent && currentParent.__widget === this._parentWidget,
          'Attempt to show under node belonging to alien widget');
    }

    const wasVisible = this._visible;
    if (wasVisible && this.element.parentElement === parentElement) {
      return;
    }

    this._visible = true;

    if (!wasVisible && this._parentIsShowing()) {
      this._processWillShow();
    }

    this.element.classList.remove('hidden');

    // Reparent
    if (this.element.parentElement !== parentElement) {
      if (!this._externallyManaged) {
        Widget._incrementWidgetCounter(parentElement, this.element);
      }
      if (insertBefore) {
        Widget._originalInsertBefore.call(parentElement, this.element, insertBefore);
      } else {
        Widget._originalAppendChild.call(parentElement, this.element);
      }
    }

    if (!wasVisible && this._parentIsShowing()) {
      this._processWasShown();
    }

    if (this._parentWidget && this._hasNonZeroConstraints()) {
      this._parentWidget.invalidateConstraints();
    } else {
      this._processOnResize();
    }
  }

  hideWidget() {
    if (!this._visible) {
      return;
    }
    this._hideWidget(false);
  }

  /**
   * @param {boolean} removeFromDOM
   */
  _hideWidget(removeFromDOM) {
    this._visible = false;
    const parentElement = this.element.parentElement;

    if (this._parentIsShowing()) {
      this._processWillHide();
    }

    if (removeFromDOM) {
      // Force legal removal
      Widget._decrementWidgetCounter(parentElement, this.element);
      Widget._originalRemoveChild.call(parentElement, this.element);
    } else {
      this.element.classList.add('hidden');
    }

    if (this._parentIsShowing()) {
      this._processWasHidden();
    }
    if (this._parentWidget && this._hasNonZeroConstraints()) {
      this._parentWidget.invalidateConstraints();
    }
  }

  /**
   * @param {boolean=} overrideHideOnDetach
   */
  detach(overrideHideOnDetach) {
    if (!this._parentWidget && !this._isRoot) {
      return;
    }

    // hideOnDetach means that we should never remove element from dom - content
    // has iframes and detaching it will hurt.
    //
    // overrideHideOnDetach will override hideOnDetach and the client takes
    // responsibility for the consequences.
    const removeFromDOM = overrideHideOnDetach || !this.shouldHideOnDetach();
    if (this._visible) {
      this._hideWidget(removeFromDOM);
    } else if (removeFromDOM && this.element.parentElement) {
      const parentElement = this.element.parentElement;
      // Force kick out from DOM.
      Widget._decrementWidgetCounter(parentElement, this.element);
      Widget._originalRemoveChild.call(parentElement, this.element);
    }

    // Update widget hierarchy.
    if (this._parentWidget) {
      const childIndex = this._parentWidget._children.indexOf(this);
      Widget.__assert(childIndex >= 0, 'Attempt to remove non-child widget');
      this._parentWidget._children.splice(childIndex, 1);
      if (this._parentWidget._defaultFocusedChild === this) {
        this._parentWidget._defaultFocusedChild = null;
      }
      this._parentWidget.childWasDetached(this);
      this._parentWidget = null;
    } else {
      Widget.__assert(this._isRoot, 'Removing non-root widget from DOM');
    }
  }

  detachChildWidgets() {
    const children = this._children.slice();
    for (let i = 0; i < children.length; ++i) {
      children[i].detach();
    }
  }

  /**
   * @return {!Array.<!Element>}
   */
  elementsToRestoreScrollPositionsFor() {
    return [this.element];
  }

  storeScrollPositions() {
    const elements = this.elementsToRestoreScrollPositionsFor();
    for (let i = 0; i < elements.length; ++i) {
      const container = elements[i];
      container._scrollTop = container.scrollTop;
      container._scrollLeft = container.scrollLeft;
    }
  }

  restoreScrollPositions() {
    const elements = this.elementsToRestoreScrollPositionsFor();
    for (let i = 0; i < elements.length; ++i) {
      const container = elements[i];
      if (container._scrollTop) {
        container.scrollTop = container._scrollTop;
      }
      if (container._scrollLeft) {
        container.scrollLeft = container._scrollLeft;
      }
    }
  }

  doResize() {
    if (!this.isShowing()) {
      return;
    }
    // No matter what notification we are in, dispatching onResize is not needed.
    if (!this._inNotification()) {
      this._callOnVisibleChildren(this._processOnResize);
    }
  }

  doLayout() {
    if (!this.isShowing()) {
      return;
    }
    this._notify(this.onLayout);
    this.doResize();
  }

  /**
   * @param {string} cssFile
   */
  registerRequiredCSS(cssFile) {
    UI.appendStyle(this._isWebComponent ? this._shadowRoot : this.element, cssFile);
  }

  printWidgetHierarchy() {
    const lines = [];
    this._collectWidgetHierarchy('', lines);
    console.log(lines.join('\n'));  // eslint-disable-line no-console
  }

  _collectWidgetHierarchy(prefix, lines) {
    lines.push(prefix + '[' + this.element.className + ']' + (this._children.length ? ' {' : ''));

    for (let i = 0; i < this._children.length; ++i) {
      this._children[i]._collectWidgetHierarchy(prefix + '    ', lines);
    }

    if (this._children.length) {
      lines.push(prefix + '}');
    }
  }

  /**
   * @param {?Element} element
   */
  setDefaultFocusedElement(element) {
    this._defaultFocusedElement = element;
  }

  /**
   * @param {!Widget} child
   */
  setDefaultFocusedChild(child) {
    Widget.__assert(child._parentWidget === this, 'Attempt to set non-child widget as default focused.');
    this._defaultFocusedChild = child;
  }

  focus() {
    if (!this.isShowing()) {
      return;
    }

    const element = this._defaultFocusedElement;
    if (element) {
      if (!element.hasFocus()) {
        element.focus();
      }
      return;
    }

    if (this._defaultFocusedChild && this._defaultFocusedChild._visible) {
      this._defaultFocusedChild.focus();
    } else {
      for (const child of this._children) {
        if (child._visible) {
          child.focus();
          return;
        }
      }
      let child = this.contentElement.traverseNextNode(this.contentElement);
      while (child) {
        if (child instanceof UI.XWidget) {
          child.focus();
          return;
        }
        child = child.traverseNextNode(this.contentElement);
      }
    }
  }

  /**
   * @return {boolean}
   */
  hasFocus() {
    return this.element.hasFocus();
  }

  /**
   * @return {!UI.Constraints}
   */
  calculateConstraints() {
    return new UI.Constraints();
  }

  /**
   * @return {!UI.Constraints}
   */
  constraints() {
    if (typeof this._constraints !== 'undefined') {
      return this._constraints;
    }
    if (typeof this._cachedConstraints === 'undefined') {
      this._cachedConstraints = this.calculateConstraints();
    }
    return this._cachedConstraints;
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} preferredWidth
   * @param {number} preferredHeight
   */
  setMinimumAndPreferredSizes(width, height, preferredWidth, preferredHeight) {
    this._constraints = new UI.Constraints(new UI.Size(width, height), new UI.Size(preferredWidth, preferredHeight));
    this.invalidateConstraints();
  }

  /**
   * @param {number} width
   * @param {number} height
   */
  setMinimumSize(width, height) {
    this._constraints = new UI.Constraints(new UI.Size(width, height));
    this.invalidateConstraints();
  }

  /**
   * @return {boolean}
   */
  _hasNonZeroConstraints() {
    const constraints = this.constraints();
    return !!(
        constraints.minimum.width || constraints.minimum.height || constraints.preferred.width ||
        constraints.preferred.height);
  }

  suspendInvalidations() {
    ++this._invalidationsSuspended;
  }

  resumeInvalidations() {
    --this._invalidationsSuspended;
    if (!this._invalidationsSuspended && this._invalidationsRequested) {
      this.invalidateConstraints();
    }
  }

  invalidateConstraints() {
    if (this._invalidationsSuspended) {
      this._invalidationsRequested = true;
      return;
    }
    this._invalidationsRequested = false;
    const cached = this._cachedConstraints;
    delete this._cachedConstraints;
    const actual = this.constraints();
    if (!actual.isEqual(cached) && this._parentWidget) {
      this._parentWidget.invalidateConstraints();
    } else {
      this.doLayout();
    }
  }

  // Excludes the widget from being tracked by its parents/ancestors via
  // __widgetCounter because the widget is being handled by external code.
  // Widgets marked as being externally managed are responsible for
  // finishing out their own lifecycle (i.e. calling detach() before being
  // removed from the DOM). This is e.g. used for CodeMirror.
  //
  // Also note that this must be called before the widget is shown so that
  // so that its ancestor's __widgetCounter is not incremented.
  markAsExternallyManaged() {
    Widget.__assert(!this._parentWidget, 'Attempt to mark widget as externally managed after insertion to the DOM');
    this._externallyManaged = true;
  }
}

const _originalAppendChild = Element.prototype.appendChild;
const _originalInsertBefore = Element.prototype.insertBefore;
const _originalRemoveChild = Element.prototype.removeChild;
const _originalRemoveChildren = Element.prototype.removeChildren;


/**
 * @unrestricted
 */
class VBox extends Widget {
  /**
   * @param {boolean=} isWebComponent
   * @param {boolean=} delegatesFocus
   */
  constructor(isWebComponent, delegatesFocus) {
    super(isWebComponent, delegatesFocus);
    this.contentElement.classList.add('vbox');
  }

  /**
   * @override
   * @return {!UI.Constraints}
   */
  calculateConstraints() {
    let constraints = new UI.Constraints();

    /**
     * @this {!Widget}
     * @suppressReceiverCheck
     */
    function updateForChild() {
      const child = this.constraints();
      constraints = constraints.widthToMax(child);
      constraints = constraints.addHeight(child);
    }

    this._callOnVisibleChildren(updateForChild);
    return constraints;
  }
}

/**
 * @unrestricted
 */
class HBox extends Widget {
  /**
   * @param {boolean=} isWebComponent
   */
  constructor(isWebComponent) {
    super(isWebComponent);
    this.contentElement.classList.add('hbox');
  }

  /**
   * @override
   * @return {!UI.Constraints}
   */
  calculateConstraints() {
    let constraints = new UI.Constraints();

    /**
     * @this {!Widget}
     * @suppressReceiverCheck
     */
    function updateForChild() {
      const child = this.constraints();
      constraints = constraints.addWidth(child);
      constraints = constraints.heightToMax(child);
    }

    this._callOnVisibleChildren(updateForChild);
    return constraints;
  }
}

/**
 * @unrestricted
 */
class VBoxWithResizeCallback extends VBox {
  /**
   * @param {function()} resizeCallback
   */
  constructor(resizeCallback) {
    super();
    this._resizeCallback = resizeCallback;
  }

  /**
   * @override
   */
  onResize() {
    this._resizeCallback();
  }
}

/**
 * @unrestricted
 */
class WidgetFocusRestorer {
  /**
   * @param {!Widget} widget
   */
  constructor(widget) {
    this._widget = widget;
    this._previous = widget.element.ownerDocument.deepActiveElement();
    widget.focus();
  }

  restore() {
    if (!this._widget) {
      return;
    }
    if (this._widget.hasFocus() && this._previous) {
      this._previous.focus();
    }
    this._previous = null;
    this._widget = null;
  }
}

/**
 * @override
 * @param {?Node} child
 * @return {!Node}
 * @suppress {duplicate}
 */
Element.prototype.appendChild = function(child) {
  Widget.__assert(!child.__widget || child.parentElement === this, 'Attempt to add widget via regular DOM operation.');
  return Widget._originalAppendChild.call(this, child);
};

/**
 * @override
 * @param {?Node} child
 * @param {?Node} anchor
 * @return {!Node}
 * @suppress {duplicate}
 */
Element.prototype.insertBefore = function(child, anchor) {
  Widget.__assert(!child.__widget || child.parentElement === this, 'Attempt to add widget via regular DOM operation.');
  return Widget._originalInsertBefore.call(this, child, anchor);
};

/**
 * @override
 * @param {?Node} child
 * @return {!Node}
 * @suppress {duplicate}
 */
Element.prototype.removeChild = function(child) {
  Widget.__assert(
      !child.__widgetCounter && !child.__widget,
      'Attempt to remove element containing widget via regular DOM operation');
  return Widget._originalRemoveChild.call(this, child);
};

Element.prototype.removeChildren = function() {
  Widget.__assert(!this.__widgetCounter, 'Attempt to remove element containing widget via regular DOM operation');
  Widget._originalRemoveChildren.call(this);
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Widget = Widget;

Widget._originalAppendChild = _originalAppendChild;
Widget._originalInsertBefore = _originalInsertBefore;
Widget._originalRemoveChild = _originalRemoveChild;
Widget._originalRemoveChildren = _originalRemoveChildren;

/** @constructor */
UI.HBox = HBox;

/** @constructor */
UI.VBox = VBox;

/** @constructor */
UI.WidgetFocusRestorer = WidgetFocusRestorer;

/** @constructor */
UI.VBoxWithResizeCallback = VBoxWithResizeCallback;

var Widget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Widget,
  _originalAppendChild: _originalAppendChild,
  _originalInsertBefore: _originalInsertBefore,
  _originalRemoveChild: _originalRemoveChild,
  _originalRemoveChildren: _originalRemoveChildren,
  VBox: VBox,
  HBox: HBox,
  VBoxWithResizeCallback: VBoxWithResizeCallback,
  WidgetFocusRestorer: WidgetFocusRestorer
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class GlassPane {
  constructor() {
    this._widget = new UI.Widget(true);
    this._widget.markAsRoot();
    this.element = this._widget.element;
    this.contentElement = this._widget.contentElement;
    this._arrowElement = UI.Icon.create('', 'arrow hidden');
    this.element.shadowRoot.appendChild(this._arrowElement);

    this.registerRequiredCSS('ui/glassPane.css');
    this.setPointerEventsBehavior(GlassPane.PointerEventsBehavior.PierceGlassPane);

    this._onMouseDownBound = this._onMouseDown.bind(this);
    /** @type {?function(!Event)} */
    this._onClickOutsideCallback = null;
    /** @type {?UI.Size} */
    this._maxSize = null;
    /** @type {?number} */
    this._positionX = null;
    /** @type {?number} */
    this._positionY = null;
    /** @type {?AnchorBox} */
    this._anchorBox = null;
    this._anchorBehavior = GlassPane.AnchorBehavior.PreferTop;
    this._sizeBehavior = GlassPane.SizeBehavior.SetExactSize;
    this._marginBehavior = GlassPane.MarginBehavior.DefaultMargin;
  }

  /**
   * @return {boolean}
   */
  isShowing() {
    return this._widget.isShowing();
  }

  /**
   * @param {string} cssFile
   */
  registerRequiredCSS(cssFile) {
    this._widget.registerRequiredCSS(cssFile);
  }

  /**
   * @param {?Element} element
   */
  setDefaultFocusedElement(element) {
    this._widget.setDefaultFocusedElement(element);
  }

  /**
   * @param {boolean} dimmed
   */
  setDimmed(dimmed) {
    this.element.classList.toggle('dimmed-pane', dimmed);
  }

  /**
   * @param {!GlassPane.PointerEventsBehavior} pointerEventsBehavior
   */
  setPointerEventsBehavior(pointerEventsBehavior) {
    this.element.classList.toggle(
        'no-pointer-events', pointerEventsBehavior !== GlassPane.PointerEventsBehavior.BlockedByGlassPane);
    this.contentElement.classList.toggle(
        'no-pointer-events', pointerEventsBehavior === GlassPane.PointerEventsBehavior.PierceContents);
  }

  /**
   * @param {?function(!Event)} callback
   */
  setOutsideClickCallback(callback) {
    this._onClickOutsideCallback = callback;
  }

  /**
   * @param {?UI.Size} size
   */
  setMaxContentSize(size) {
    this._maxSize = size;
    this._positionContent();
  }

  /**
   * @param {!GlassPane.SizeBehavior} sizeBehavior
   */
  setSizeBehavior(sizeBehavior) {
    this._sizeBehavior = sizeBehavior;
    this._positionContent();
  }

  /**
   * @param {?number} x
   * @param {?number} y
   * Position is relative to root element.
   */
  setContentPosition(x, y) {
    this._positionX = x;
    this._positionY = y;
    this._positionContent();
  }

  /**
   * @param {?AnchorBox} anchorBox
   * Anchor box is relative to the document.
   */
  setContentAnchorBox(anchorBox) {
    this._anchorBox = anchorBox;
    this._positionContent();
  }

  /**
   * @param {!GlassPane.AnchorBehavior} behavior
   */
  setAnchorBehavior(behavior) {
    this._anchorBehavior = behavior;
  }

  /**
   * @param {!GlassPane.MarginBehavior} behavior
   */
  setMarginBehavior(behavior) {
    this._marginBehavior = behavior;
    this._arrowElement.classList.toggle('hidden', behavior !== GlassPane.MarginBehavior.Arrow);
  }

  /**
   * @param {!Document} document
   */
  show(document) {
    if (this.isShowing()) {
      return;
    }
    // TODO(crbug.com/1006759): Extract the magic number
    // Deliberately starts with 3000 to hide other z-indexed elements below.
    this.element.style.zIndex = 3000 + 1000 * GlassPane._panes.size;
    document.body.addEventListener('mousedown', this._onMouseDownBound, true);
    this._widget.show(document.body);
    GlassPane._panes.add(this);
    this._positionContent();
  }

  hide() {
    if (!this.isShowing()) {
      return;
    }
    GlassPane._panes.delete(this);
    this.element.ownerDocument.body.removeEventListener('mousedown', this._onMouseDownBound, true);
    this._widget.detach();
  }

  /**
   * @param {!Event} event
   */
  _onMouseDown(event) {
    if (!this._onClickOutsideCallback) {
      return;
    }
    const node = event.deepElementFromPoint();
    if (!node || this.contentElement.isSelfOrAncestor(node)) {
      return;
    }
    this._onClickOutsideCallback.call(null, event);
  }

  _positionContent() {
    if (!this.isShowing()) {
      return;
    }

    const showArrow = this._marginBehavior === GlassPane.MarginBehavior.Arrow;
    const gutterSize = showArrow ? 8 : (this._marginBehavior === GlassPane.MarginBehavior.NoMargin ? 0 : 3);
    const scrollbarSize = UI.measuredScrollbarWidth(this.element.ownerDocument);
    const arrowSize = 10;

    const container = GlassPane._containers.get(/** @type {!Document} */ (this.element.ownerDocument));
    if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
      this.contentElement.positionAt(0, 0);
      this.contentElement.style.width = '';
      this.contentElement.style.maxWidth = '';
      this.contentElement.style.height = '';
      this.contentElement.style.maxHeight = '';
    }

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    let width = containerWidth - gutterSize * 2;
    let height = containerHeight - gutterSize * 2;
    let positionX = gutterSize;
    let positionY = gutterSize;

    if (this._maxSize) {
      width = Math.min(width, this._maxSize.width);
      height = Math.min(height, this._maxSize.height);
    }

    if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
      const measuredRect = this.contentElement.getBoundingClientRect();
      const widthOverflow = height < measuredRect.height ? scrollbarSize : 0;
      const heightOverflow = width < measuredRect.width ? scrollbarSize : 0;
      width = Math.min(width, measuredRect.width + widthOverflow);
      height = Math.min(height, measuredRect.height + heightOverflow);
    }

    if (this._anchorBox) {
      const anchorBox = this._anchorBox.relativeToElement(container);
      let behavior = this._anchorBehavior;
      this._arrowElement.classList.remove('arrow-none', 'arrow-top', 'arrow-bottom', 'arrow-left', 'arrow-right');

      if (behavior === GlassPane.AnchorBehavior.PreferTop || behavior === GlassPane.AnchorBehavior.PreferBottom) {
        const top = anchorBox.y - 2 * gutterSize;
        const bottom = containerHeight - anchorBox.y - anchorBox.height - 2 * gutterSize;
        if (behavior === GlassPane.AnchorBehavior.PreferTop && top < height && bottom > top) {
          behavior = GlassPane.AnchorBehavior.PreferBottom;
        }
        if (behavior === GlassPane.AnchorBehavior.PreferBottom && bottom < height && top > bottom) {
          behavior = GlassPane.AnchorBehavior.PreferTop;
        }

        let arrowY;
        let enoughHeight = true;
        if (behavior === GlassPane.AnchorBehavior.PreferTop) {
          positionY = Math.max(gutterSize, anchorBox.y - height - gutterSize);
          const spaceTop = anchorBox.y - positionY - gutterSize;
          if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
            if (height > spaceTop) {
              this._arrowElement.classList.add('arrow-none');
              enoughHeight = false;
            }
          } else {
            height = Math.min(height, spaceTop);
          }
          this._arrowElement.setIconType('mediumicon-arrow-bottom');
          this._arrowElement.classList.add('arrow-bottom');
          arrowY = anchorBox.y - gutterSize;
        } else {
          positionY = anchorBox.y + anchorBox.height + gutterSize;
          const spaceBottom = containerHeight - positionY - gutterSize;
          if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
            if (height > spaceBottom) {
              this._arrowElement.classList.add('arrow-none');
              positionY = containerHeight - gutterSize - height;
              enoughHeight = false;
            }
          } else {
            height = Math.min(height, spaceBottom);
          }
          this._arrowElement.setIconType('mediumicon-arrow-top');
          this._arrowElement.classList.add('arrow-top');
          arrowY = anchorBox.y + anchorBox.height + gutterSize;
        }

        positionX = Math.max(gutterSize, Math.min(anchorBox.x, containerWidth - width - gutterSize));
        if (!enoughHeight) {
          positionX = Math.min(positionX + arrowSize, containerWidth - width - gutterSize);
        } else if (showArrow && positionX - arrowSize >= gutterSize) {
          positionX -= arrowSize;
        }
        width = Math.min(width, containerWidth - positionX - gutterSize);
        if (2 * arrowSize >= width) {
          this._arrowElement.classList.add('arrow-none');
        } else {
          let arrowX = anchorBox.x + Math.min(50, Math.floor(anchorBox.width / 2));
          arrowX = Number.constrain(arrowX, positionX + arrowSize, positionX + width - arrowSize);
          this._arrowElement.positionAt(arrowX, arrowY, container);
        }
      } else {
        const left = anchorBox.x - 2 * gutterSize;
        const right = containerWidth - anchorBox.x - anchorBox.width - 2 * gutterSize;
        if (behavior === GlassPane.AnchorBehavior.PreferLeft && left < width && right > left) {
          behavior = GlassPane.AnchorBehavior.PreferRight;
        }
        if (behavior === GlassPane.AnchorBehavior.PreferRight && right < width && left > right) {
          behavior = GlassPane.AnchorBehavior.PreferLeft;
        }

        let arrowX;
        let enoughWidth = true;
        if (behavior === GlassPane.AnchorBehavior.PreferLeft) {
          positionX = Math.max(gutterSize, anchorBox.x - width - gutterSize);
          const spaceLeft = anchorBox.x - positionX - gutterSize;
          if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
            if (width > spaceLeft) {
              this._arrowElement.classList.add('arrow-none');
              enoughWidth = false;
            }
          } else {
            width = Math.min(width, spaceLeft);
          }
          this._arrowElement.setIconType('mediumicon-arrow-right');
          this._arrowElement.classList.add('arrow-right');
          arrowX = anchorBox.x - gutterSize;
        } else {
          positionX = anchorBox.x + anchorBox.width + gutterSize;
          const spaceRight = containerWidth - positionX - gutterSize;
          if (this._sizeBehavior === GlassPane.SizeBehavior.MeasureContent) {
            if (width > spaceRight) {
              this._arrowElement.classList.add('arrow-none');
              positionX = containerWidth - gutterSize - width;
              enoughWidth = false;
            }
          } else {
            width = Math.min(width, spaceRight);
          }
          this._arrowElement.setIconType('mediumicon-arrow-left');
          this._arrowElement.classList.add('arrow-left');
          arrowX = anchorBox.x + anchorBox.width + gutterSize;
        }

        positionY = Math.max(gutterSize, Math.min(anchorBox.y, containerHeight - height - gutterSize));
        if (!enoughWidth) {
          positionY = Math.min(positionY + arrowSize, containerHeight - height - gutterSize);
        } else if (showArrow && positionY - arrowSize >= gutterSize) {
          positionY -= arrowSize;
        }
        height = Math.min(height, containerHeight - positionY - gutterSize);
        if (2 * arrowSize >= height) {
          this._arrowElement.classList.add('arrow-none');
        } else {
          let arrowY = anchorBox.y + Math.min(50, Math.floor(anchorBox.height / 2));
          arrowY = Number.constrain(arrowY, positionY + arrowSize, positionY + height - arrowSize);
          this._arrowElement.positionAt(arrowX, arrowY, container);
        }
      }
    } else {
      positionX = this._positionX !== null ? this._positionX : (containerWidth - width) / 2;
      positionY = this._positionY !== null ? this._positionY : (containerHeight - height) / 2;
      width = Math.min(width, containerWidth - positionX - gutterSize);
      height = Math.min(height, containerHeight - positionY - gutterSize);
      this._arrowElement.classList.add('arrow-none');
    }

    this.contentElement.style.width = width + 'px';
    if (this._sizeBehavior === GlassPane.SizeBehavior.SetExactWidthMaxHeight) {
      this.contentElement.style.maxHeight = height + 'px';
    } else {
      this.contentElement.style.height = height + 'px';
    }

    this.contentElement.positionAt(positionX, positionY, container);
    this._widget.doResize();
  }

  /**
   * @protected
   * @return {!UI.Widget}
   */
  widget() {
    return this._widget;
  }

  /**
   * @param {!Element} element
   */
  static setContainer(element) {
    GlassPane._containers.set(/** @type {!Document} */ (element.ownerDocument), element);
    GlassPane.containerMoved(element);
  }

  /**
   * @param {!Document} document
   * @return {!Element}
   */
  static container(document) {
    return GlassPane._containers.get(document);
  }

  /**
   * @param {!Element} element
   */
  static containerMoved(element) {
    for (const pane of GlassPane._panes) {
      if (pane.isShowing() && pane.element.ownerDocument === element.ownerDocument) {
        pane._positionContent();
      }
    }
  }
}

/** @enum {symbol} */
const PointerEventsBehavior = {
  BlockedByGlassPane: Symbol('BlockedByGlassPane'),
  PierceGlassPane: Symbol('PierceGlassPane'),
  PierceContents: Symbol('PierceContents')
};

/** @enum {symbol} */
const AnchorBehavior = {
  PreferTop: Symbol('PreferTop'),
  PreferBottom: Symbol('PreferBottom'),
  PreferLeft: Symbol('PreferLeft'),
  PreferRight: Symbol('PreferRight'),
};

/** @enum {symbol} */
const SizeBehavior = {
  SetExactSize: Symbol('SetExactSize'),
  SetExactWidthMaxHeight: Symbol('SetExactWidthMaxHeight'),
  MeasureContent: Symbol('MeasureContent')
};

/** @enum {symbol} */
const MarginBehavior = {
  Arrow: Symbol('Arrow'),
  DefaultMargin: Symbol('DefaultMargin'),
  NoMargin: Symbol('NoMargin')
};

/** @type {!Map<!Document, !Element>} */
const _containers = new Map();

/** @type {!Set<!GlassPane>} */
const _panes = new Set();

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.GlassPane = GlassPane;

/** @enum {symbol} */
UI.GlassPane.PointerEventsBehavior = PointerEventsBehavior;

/** @enum {symbol} */
UI.GlassPane.AnchorBehavior = AnchorBehavior;

/** @enum {symbol} */
UI.GlassPane.SizeBehavior = SizeBehavior;

/** @enum {symbol} */
UI.GlassPane.MarginBehavior = MarginBehavior;

/** @type {!Map<!Document, !Element>} */
UI.GlassPane._containers = _containers;

/** @type {!Set<!GlassPane>} */
UI.GlassPane._panes = _panes;

var GlassPane$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': GlassPane,
  PointerEventsBehavior: PointerEventsBehavior,
  AnchorBehavior: AnchorBehavior,
  SizeBehavior: SizeBehavior,
  MarginBehavior: MarginBehavior,
  _containers: _containers,
  _panes: _panes
});

// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @unrestricted
 */
class Action extends Common.Object {
  /**
   * @param {!Root.Runtime.Extension} extension
   */
  constructor(extension) {
    super();
    this._extension = extension;
    this._enabled = true;
    this._toggled = false;
  }

  /**
   * @return {string}
   */
  id() {
    return this._extension.descriptor()['actionId'];
  }

  /**
   * @return {!Runtime.Extension}
   */
  extension() {
    return this._extension;
  }

  /**
   * @return {!Promise.<boolean>}
   */
  execute() {
    return this._extension.instance().then(handleAction.bind(this));

    /**
     * @param {!Object} actionDelegate
     * @return {boolean}
     * @this {UI.Action}
     */
    function handleAction(actionDelegate) {
      const actionId = this._extension.descriptor()['actionId'];
      const delegate = /** @type {!UI.ActionDelegate} */ (actionDelegate);
      return delegate.handleAction(UI.context, actionId);
    }
  }

  /**
   * @return {string}
   */
  icon() {
    return this._extension.descriptor()['iconClass'] || '';
  }

  /**
   * @return {string}
   */
  toggledIcon() {
    return this._extension.descriptor()['toggledIconClass'] || '';
  }

  /**
   * @return {boolean}
   */
  toggleWithRedColor() {
    return !!this._extension.descriptor()['toggleWithRedColor'];
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    if (this._enabled === enabled) {
      return;
    }

    this._enabled = enabled;
    this.dispatchEventToListeners(Events$9.Enabled, enabled);
  }

  /**
   * @return {boolean}
   */
  enabled() {
    return this._enabled;
  }

  /**
   * @return {string}
   */
  category() {
    return ls(this._extension.descriptor()['category'] || '');
  }

  /**
   * @return {string}
   */
  tags() {
    return this._extension.descriptor()['tags'] || '';
  }

  /**
   * @return {boolean}
   */
  toggleable() {
    return !!this._extension.descriptor()['toggleable'];
  }

  /**
   * @return {string}
   */
  title() {
    let title = this._extension.title() || '';
    const options = this._extension.descriptor()['options'];
    if (options) {
      for (const pair of options) {
        if (pair['value'] !== this._toggled) {
          title = ls(pair['title']);
        }
      }
    }
    return title;
  }

  /**
   * @return {boolean}
   */
  toggled() {
    return this._toggled;
  }

  /**
   * @param {boolean} toggled
   */
  setToggled(toggled) {
    console.assert(this.toggleable(), 'Shouldn\'t be toggling an untoggleable action', this.id());
    if (this._toggled === toggled) {
      return;
    }

    this._toggled = toggled;
    this.dispatchEventToListeners(Events$9.Toggled, toggled);
  }
}

/** @enum {symbol} */
const Events$9 = {
  Enabled: Symbol('Enabled'),
  Toggled: Symbol('Toggled')
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Action = Action;

/** @enum {symbol} */
UI.Action.Events = Events$9;

var Action$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Action
});

// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @interface
 */
class ActionDelegate$1 {
  /**
   * @param {!UI.Context} context
   * @param {string} actionId
   * @return {boolean}
   */
  handleAction(context, actionId) {
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @interface */
UI.ActionDelegate = ActionDelegate$1;

var ActionDelegate$2 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ActionDelegate$1
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ActionRegistry {
  constructor() {
    /** @type {!Map.<string, !UI.Action>} */
    this._actionsById = new Map();
    this._registerActions();
  }

  _registerActions() {
    self.runtime.extensions('action').forEach(registerExtension, this);

    /**
     * @param {!Root.Runtime.Extension} extension
     * @this {UI.ActionRegistry}
     */
    function registerExtension(extension) {
      if (!extension.canInstantiate()) {
        return;
      }
      const actionId = extension.descriptor()['actionId'];
      console.assert(actionId);
      console.assert(!this._actionsById.get(actionId));

      const action = new UI.Action(extension);
      if (!action.category() || action.title()) {
        this._actionsById.set(actionId, action);
      } else {
        console.error(`Category actions require a title for command menu: ${actionId}`);
      }
    }
  }

  /**
   * @return {!Array.<!UI.Action>}
   */
  availableActions() {
    return this.applicableActions(this._actionsById.keysArray(), UI.context);
  }

  /**
   * @param {!Array.<string>} actionIds
   * @param {!UI.Context} context
   * @return {!Array.<!UI.Action>}
   */
  applicableActions(actionIds, context) {
    const extensions = [];
    actionIds.forEach(function(actionId) {
      const action = this._actionsById.get(actionId);
      if (action) {
        extensions.push(action.extension());
      }
    }, this);
    return context.applicableExtensions(extensions).valuesArray().map(extensionToAction.bind(this));

    /**
     * @param {!Root.Runtime.Extension} extension
     * @return {!UI.Action}
     * @this {UI.ActionRegistry}
     */
    function extensionToAction(extension) {
      return /** @type {!UI.Action} */ (this.action(extension.descriptor()['actionId']));
    }
  }

  /**
   * @param {string} actionId
   * @return {?UI.Action}
   */
  action(actionId) {
    return this._actionsById.get(actionId) || null;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ActionRegistry = ActionRegistry;

/** @type {!UI.ActionRegistry} */
UI.actionRegistry;

var ActionRegistry$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ActionRegistry
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

let _id = 0;

/**
 * @param {string} prefix
 * @return {string}
 */
function nextId(prefix) {
  return (prefix || '') + ++_id;
}

/**
 * @param {!Element} label
 * @param {!Element} control
 */
function bindLabelToControl(label, control) {
  const controlId = nextId('labelledControl');
  control.id = controlId;
  label.setAttribute('for', controlId);
}

/**
 * @param {!Element} element
 */
function markAsAlert(element) {
  element.setAttribute('role', 'alert');
  element.setAttribute('aria-live', 'polite');
}

/**
 * @param {!Element} element
 */
function markAsButton(element) {
  element.setAttribute('role', 'button');
}

/**
 * @param {!Element} element
 */
function markAsCheckbox(element) {
  element.setAttribute('role', 'checkbox');
}

/**
 * @param {!Element} element
 */
function markAsCombobox(element) {
  element.setAttribute('role', 'combobox');
}

/**
 * @param {!Element} element
 */
function markAsModalDialog(element) {
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'true');
}

/**
 * @param {!Element} element
 */
function markAsGroup(element) {
  element.setAttribute('role', 'group');
}

/**
 * @param {!Element} element
 */
function markAsLink(element) {
  element.setAttribute('role', 'link');
}

/**
 * @param {!Element} element
 */
function markAsMenuButton(element) {
  markAsButton(element);
  element.setAttribute('aria-haspopup', true);
}

/**
 * @param {!Element} element
 * @param {number=} min
 * @param {number=} max
 */
function markAsProgressBar(element, min = 0, max = 100) {
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-valuemin', min);
  element.setAttribute('aria-valuemax', max);
}

/**
 * @param {!Element} element
 */
function markAsTab(element) {
  element.setAttribute('role', 'tab');
}

/**
 * @param {!Element} element
 */
function markAsTree(element) {
  element.setAttribute('role', 'tree');
}

/**
 * @param {!Element} element
 */
function markAsTreeitem(element) {
  element.setAttribute('role', 'treeitem');
}

/**
 * @param {!Element} element
 */
function markAsTextBox(element) {
  element.setAttribute('role', 'textbox');
}

/**
 * @param {!Element} element
 */
function markAsMenu(element) {
  element.setAttribute('role', 'menu');
}

/**
 * @param {!Element} element
 */
function markAsMenuItem(element) {
  element.setAttribute('role', 'menuitem');
}

/**
 * @param {!Element} element
 */
function markAsMenuItemSubMenu(element) {
  markAsMenuItem(element);
  element.setAttribute('aria-haspopup', true);
}

/**
 * @param {!Element} element
 */
function markAsList(element) {
  element.setAttribute('role', 'list');
}

/**
 * @param {!Element} element
 */
function markAsListitem(element) {
  element.setAttribute('role', 'listitem');
}

/**
 * Must contain children whose role is option.
 * @param {!Element} element
 */
function markAsListBox(element) {
  element.setAttribute('role', 'listbox');
}

/**
 * @param {!Element} element
 */
function markAsMultiSelectable(element) {
  element.setAttribute('aria-multiselectable', 'true');
}

/**
 * Must be contained in, or owned by, an element with the role listbox.
 * @param {!Element} element
 */
function markAsOption(element) {
  element.setAttribute('role', 'option');
}

/**
 * @param {!Element} element
 */
function markAsRadioGroup(element) {
  element.setAttribute('role', 'radiogroup');
}

/**
 * @param {!Element} element
 */
function markAsHidden(element) {
  element.setAttribute('aria-hidden', 'true');
}

/**
 * @param {!Element} element
 * @param {number} level
 */
function markAsHeading(element, level) {
  element.setAttribute('role', 'heading');
  element.setAttribute('aria-level', level);
}

/**
 * @param {!Element} element
 */
function markAsPoliteLiveRegion(element) {
  element.setAttribute('aria-live', 'polite');
}

/**
 * @param {!Element} element
 * @param {?string} placeholder
 */
function setPlaceholder(element, placeholder) {
  if (placeholder) {
    element.setAttribute('aria-placeholder', placeholder);
  } else {
    element.removeAttribute('aria-placeholder');
  }
}

/**
 * @param {!Element} element
 */
function markAsPresentation(element) {
  element.setAttribute('role', 'presentation');
}

/**
 * @param {!Element} element
 */
function markAsStatus(element) {
  element.setAttribute('role', 'status');
}

/**
 * @param {!Element} element
 */
function ensureId(element) {
  if (!element.id) {
    element.id = nextId('ariaElement');
  }
}

/**
 * @param {!Element} element
 * @param {?Element} controlledElement
 */
function setControls(element, controlledElement) {
  if (!controlledElement) {
    element.removeAttribute('aria-controls');
    return;
  }

  ensureId(controlledElement);
  element.setAttribute('aria-controls', controlledElement.id);
}

/**
 * @param {!Element} element
 * @param {boolean} value
 */
function setChecked(element, value) {
  element.setAttribute('aria-checked', !!value);
}

/**
 * @param {!Element} element
 */
function setCheckboxAsIndeterminate(element) {
  element.setAttribute('aria-checked', 'mixed');
}

/**
 * @param {!Element} element
 * @param {boolean} value
 */
function setExpanded(element, value) {
  element.setAttribute('aria-expanded', !!value);
}

/**
 * @param {!Element} element
 */
function unsetExpandable(element) {
  element.removeAttribute('aria-expanded');
}

/**
 * @enum {string}
 */
const AutocompleteInteractionModel = {
  inline: 'inline',
  list: 'list',
  both: 'both',
  none: 'none',
};

/**
 * @param {!Element} element
 * @param {!AutocompleteInteractionModel=} interactionModel
 */
function setAutocomplete(element, interactionModel = AutocompleteInteractionModel.none) {
  element.setAttribute('aria-autocomplete', interactionModel);
}

/**
 * @param {!Element} element
 * @param {boolean} value
 */
function setSelected(element, value) {
  // aria-selected behaves differently for false and undefined.
  // Often times undefined values are unintentionally typed as booleans.
  // Use !! to make sure this is true or false.
  element.setAttribute('aria-selected', !!value);
}

/**
 * @param {!Element} element
 * @param {boolean} value
 */
function setInvalid(element, value) {
  if (value) {
    element.setAttribute('aria-invalid', value);
  } else {
    element.removeAttribute('aria-invalid');
  }
}

/**
 * @param {!Element} element
 * @param {boolean} value
 */
function setPressed(element, value) {
  // aria-pressed behaves differently for false and undefined.
  // Often times undefined values are unintentionally typed as booleans.
  // Use !! to make sure this is true or false.
  element.setAttribute('aria-pressed', !!value);
}

/**
 * @param {!Element} element
 * @param {number} value
 */
function setProgressBarCurrentPercentage(element, value) {
  element.setAttribute('aria-valuenow', value);
}

/**
 * @param {!Element} element
 * @param {string} name
 */
function setAccessibleName(element, name) {
  element.setAttribute('aria-label', name);
}

/** @type {!WeakMap<!Element, !Element>} */
const _descriptionMap = new WeakMap();

/**
 * @param {!Element} element
 * @param {string} description
 */
function setDescription(element, description) {
  // Nodes in the accesesibility tree are made up of a core
  // triplet of "name", "value", "description"
  // The "description" field is taken from either
  // 1. The title html attribute
  // 2. The value of the aria-help attribute
  // 3. The textContent of an element specified by aria-describedby
  //
  // The title attribute has the side effect of causing tooltips
  // to appear with the description when the element is hovered.
  // This is usually fine, except that DevTools has its own styled
  // tooltips which would interfere with the browser tooltips.
  //
  // aria-help does what we want with no side effects, but it
  // is deprecated and may be removed in a future version of Blink.
  // Current DevTools needs to be able to work in future browsers,
  // to support debugging old mobile devices. So we can't rely on
  // any APIs that might be removed. There is also no way to feature
  // detect this API.
  //
  // aria-describedby requires that an extra element exist in DOM
  // that this element can point to. Both elements also have to
  // be in the same shadow root. This is not trivial to manage.
  // The rest of DevTools shouldn't have to worry about this,
  // so there is some unfortunate code below.

  if (_descriptionMap.has(element)) {
    _descriptionMap.get(element).remove();
  }
  element.removeAttribute('data-aria-utils-animation-hack');

  if (!description) {
    _descriptionMap.delete(element);
    element.removeAttribute('aria-describedby');
    return;
  }

  // We make a hidden element that contains the decsription
  // and will be pointed to by aria-describedby.
  const descriptionElement = createElement('span');
  descriptionElement.textContent = description;
  descriptionElement.style.display = 'none';
  ensureId(descriptionElement);
  element.setAttribute('aria-describedby', descriptionElement.id);
  _descriptionMap.set(element, descriptionElement);

  // Now we have to actually put this description element
  // somewhere in the DOM so that we can point to it.
  // It would be nice to just put it in the body, but that
  // wouldn't work if the main element is in a shadow root.
  // So the cleanest approach is to add the description element
  // as a child of the main element. But wait! Some HTML elements
  // aren't supposed to have children. Blink won't search inside
  // these elements, and won't find our description element.
  const contentfulVoidTags = new Set(['INPUT', 'IMG']);
  if (!contentfulVoidTags.has(element.tagName)) {
    element.appendChild(descriptionElement);
    // If we made it here, someone setting .textContent
    // or removeChildren on the element will blow away
    // our description. At least we tried our best!
    return;
  }

  // We have some special element, like an <input>, where putting the
  // description element inside it doesn't work.
  // Lets try the next best thing, and just put the description element
  // next to it in the DOM.
  const inserted = element.insertAdjacentElement('afterend', descriptionElement);
  if (inserted) {
    return;
  }

  // Uh oh, the insertion didn't work! That means we aren't currently in the DOM.
  // How can we find out when the element enters the DOM?
  // See inspectorCommon.css
  element.setAttribute('data-aria-utils-animation-hack', 'sorry');
  element.addEventListener('animationend', () => {
    // Someone might have made a new description in the meantime.
    if (_descriptionMap.get(element) !== descriptionElement) {
      return;
    }
    element.removeAttribute('data-aria-utils-animation-hack');

    // Try it again. This time we are in the DOM, so it *should* work.
    element.insertAdjacentElement('afterend', descriptionElement);
  }, {once: true});
}

/**
 * @param {!Element} element
 * @param {?Element} activedescendant
 */
function setActiveDescendant(element, activedescendant) {
  if (!activedescendant) {
    element.removeAttribute('aria-activedescendant');
    return;
  }

  console.assert(element.hasSameShadowRoot(activedescendant), 'elements are not in the same shadow dom');

  ensureId(activedescendant);
  element.setAttribute('aria-activedescendant', activedescendant.id);
}

const AlertElementSymbol = Symbol('AlertElementSybmol');

/**
 * @param {string} message
 * @param {!Element} element
 */
function alert(message, element) {
  const document = element.ownerDocument;
  if (!document[AlertElementSymbol]) {
    const alertElement = document.body.createChild('div');
    alertElement.style.position = 'absolute';
    alertElement.style.left = '-999em';
    alertElement.style.width = '100em';
    alertElement.style.overflow = 'hidden';
    alertElement.setAttribute('role', 'alert');
    alertElement.setAttribute('aria-atomic', 'true');
    document[AlertElementSymbol] = alertElement;
  }

  document[AlertElementSymbol].textContent = message.trimEndWithMaxLength(10000);
}

/** Legacy exported object */
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

self.UI.ARIAUtils = {
  nextId,
  bindLabelToControl,
  markAsAlert,
  markAsButton,
  markAsCheckbox,
  markAsCombobox,
  markAsModalDialog,
  markAsGroup,
  markAsLink,
  markAsMenuButton,
  markAsProgressBar,
  markAsTab,
  markAsTree,
  markAsTreeitem,
  markAsTextBox,
  markAsMenu,
  markAsMenuItem,
  markAsMenuItemSubMenu,
  markAsList,
  markAsListitem,
  markAsListBox,
  markAsMultiSelectable,
  markAsOption,
  markAsRadioGroup,
  markAsHidden,
  markAsHeading,
  markAsPoliteLiveRegion,
  setPlaceholder,
  markAsPresentation,
  markAsStatus,
  ensureId,
  setControls,
  setChecked,
  setCheckboxAsIndeterminate,
  setExpanded,
  unsetExpandable,
  AutocompleteInteractionModel,
  setAutocomplete,
  setSelected,
  setInvalid,
  setPressed,
  setProgressBarCurrentPercentage,
  setAccessibleName,
  setDescription,
  setActiveDescendant,
  alert,
};

var ARIAUtils = /*#__PURE__*/Object.freeze({
  __proto__: null,
  nextId: nextId,
  bindLabelToControl: bindLabelToControl,
  markAsAlert: markAsAlert,
  markAsButton: markAsButton,
  markAsCheckbox: markAsCheckbox,
  markAsCombobox: markAsCombobox,
  markAsModalDialog: markAsModalDialog,
  markAsGroup: markAsGroup,
  markAsLink: markAsLink,
  markAsMenuButton: markAsMenuButton,
  markAsProgressBar: markAsProgressBar,
  markAsTab: markAsTab,
  markAsTree: markAsTree,
  markAsTreeitem: markAsTreeitem,
  markAsTextBox: markAsTextBox,
  markAsMenu: markAsMenu,
  markAsMenuItem: markAsMenuItem,
  markAsMenuItemSubMenu: markAsMenuItemSubMenu,
  markAsList: markAsList,
  markAsListitem: markAsListitem,
  markAsListBox: markAsListBox,
  markAsMultiSelectable: markAsMultiSelectable,
  markAsOption: markAsOption,
  markAsRadioGroup: markAsRadioGroup,
  markAsHidden: markAsHidden,
  markAsHeading: markAsHeading,
  markAsPoliteLiveRegion: markAsPoliteLiveRegion,
  setPlaceholder: setPlaceholder,
  markAsPresentation: markAsPresentation,
  markAsStatus: markAsStatus,
  ensureId: ensureId,
  setControls: setControls,
  setChecked: setChecked,
  setCheckboxAsIndeterminate: setCheckboxAsIndeterminate,
  setExpanded: setExpanded,
  unsetExpandable: unsetExpandable,
  AutocompleteInteractionModel: AutocompleteInteractionModel,
  setAutocomplete: setAutocomplete,
  setSelected: setSelected,
  setInvalid: setInvalid,
  setPressed: setPressed,
  setProgressBarCurrentPercentage: setProgressBarCurrentPercentage,
  setAccessibleName: setAccessibleName,
  setDescription: setDescription,
  setActiveDescendant: setActiveDescendant,
  alert: alert
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class Context {
  constructor() {
    this._flavors = new Map();
    this._eventDispatchers = new Map();
  }

  /**
   * @param {function(new:T, ...)} flavorType
   * @param {?T} flavorValue
   * @template T
   */
  setFlavor(flavorType, flavorValue) {
    const value = this._flavors.get(flavorType) || null;
    if (value === flavorValue) {
      return;
    }
    if (flavorValue) {
      this._flavors.set(flavorType, flavorValue);
    } else {
      this._flavors.remove(flavorType);
    }

    this._dispatchFlavorChange(flavorType, flavorValue);
  }

  /**
   * @param {function(new:T, ...)} flavorType
   * @param {?T} flavorValue
   * @template T
   */
  _dispatchFlavorChange(flavorType, flavorValue) {
    for (const extension of self.runtime.extensions(UI.ContextFlavorListener)) {
      if (extension.hasContextType(flavorType)) {
        extension.instance().then(
            instance => /** @type {!UI.ContextFlavorListener} */ (instance).flavorChanged(flavorValue));
      }
    }
    const dispatcher = this._eventDispatchers.get(flavorType);
    if (!dispatcher) {
      return;
    }
    dispatcher.dispatchEventToListeners(Context.Events.FlavorChanged, flavorValue);
  }

  /**
   * @param {function(new:Object, ...)} flavorType
   * @param {function(!Common.Event)} listener
   * @param {!Object=} thisObject
   */
  addFlavorChangeListener(flavorType, listener, thisObject) {
    let dispatcher = this._eventDispatchers.get(flavorType);
    if (!dispatcher) {
      dispatcher = new Common.Object();
      this._eventDispatchers.set(flavorType, dispatcher);
    }
    dispatcher.addEventListener(Context.Events.FlavorChanged, listener, thisObject);
  }

  /**
   * @param {function(new:Object, ...)} flavorType
   * @param {function(!Common.Event)} listener
   * @param {!Object=} thisObject
   */
  removeFlavorChangeListener(flavorType, listener, thisObject) {
    const dispatcher = this._eventDispatchers.get(flavorType);
    if (!dispatcher) {
      return;
    }
    dispatcher.removeEventListener(Context.Events.FlavorChanged, listener, thisObject);
    if (!dispatcher.hasEventListeners(Context.Events.FlavorChanged)) {
      this._eventDispatchers.remove(flavorType);
    }
  }

  /**
   * @param {function(new:T, ...)} flavorType
   * @return {?T}
   * @template T
   */
  flavor(flavorType) {
    return this._flavors.get(flavorType) || null;
  }

  /**
   * @return {!Set.<function(new:Object, ...)>}
   */
  flavors() {
    return new Set(this._flavors.keys());
  }

  /**
   * @param {!Array.<!Root.Runtime.Extension>} extensions
   * @return {!Set.<!Root.Runtime.Extension>}
   */
  applicableExtensions(extensions) {
    const targetExtensionSet = new Set();

    const availableFlavors = this.flavors();
    extensions.forEach(function(extension) {
      if (self.runtime.isExtensionApplicableToContextTypes(extension, availableFlavors)) {
        targetExtensionSet.add(extension);
      }
    });

    return targetExtensionSet;
  }
}

/** @enum {symbol} */
const Events$8 = {
  FlavorChanged: Symbol('FlavorChanged')
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Context = Context;

/** @enum {symbol} */
UI.Context.Events = Events$8;

/** @type {!Context} */
UI.context = new Context();

var Context$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Context,
  Events: Events$8
});

// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @interface
 */
class ContextFlavorListener {
  /**
   * @param {?Object} object
   */
  flavorChanged(object) {
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @interface */
UI.ContextFlavorListener = ContextFlavorListener;

var ContextFlavorListener$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ContextFlavorListener
});

/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class Item {
  /**
   * @param {?ContextMenu} contextMenu
   * @param {string} type
   * @param {string=} label
   * @param {boolean=} disabled
   * @param {boolean=} checked
   */
  constructor(contextMenu, type, label, disabled, checked) {
    this._type = type;
    this._label = label;
    this._disabled = disabled;
    this._checked = checked;
    this._contextMenu = contextMenu;
    if (type === 'item' || type === 'checkbox') {
      this._id = contextMenu ? contextMenu._nextId() : 0;
    }
  }

  /**
   * @return {number}
   */
  id() {
    return this._id;
  }

  /**
   * @return {string}
   */
  type() {
    return this._type;
  }

  /**
   * @return {boolean}
   */
  isEnabled() {
    return !this._disabled;
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._disabled = !enabled;
  }

  /**
   * @return {!InspectorFrontendHostAPI.ContextMenuDescriptor}
   */
  _buildDescriptor() {
    switch (this._type) {
      case 'item':
        const result = {type: 'item', id: this._id, label: this._label, enabled: !this._disabled};
        if (this._customElement) {
          result.element = this._customElement;
        }
        if (this._shortcut) {
          result.shortcut = this._shortcut;
        }
        return result;
      case 'separator':
        return {type: 'separator'};
      case 'checkbox':
        return {type: 'checkbox', id: this._id, label: this._label, checked: !!this._checked, enabled: !this._disabled};
    }
    throw new Error('Invalid item type:' + this._type);
  }

  /**
   * @param {string} shortcut
   */
  setShortcut(shortcut) {
    this._shortcut = shortcut;
  }
}

/**
 * @unrestricted
 */
class Section$1 {
  /**
   * @param {?ContextMenu} contextMenu
   */
  constructor(contextMenu) {
    this._contextMenu = contextMenu;
    /** @type {!Array<!Item>} */
    this._items = [];
  }

  /**
   * @param {string} label
   * @param {function(?)} handler
   * @param {boolean=} disabled
   * @return {!Item}
   */
  appendItem(label, handler, disabled) {
    const item = new Item(this._contextMenu, 'item', label, disabled);
    this._items.push(item);
    this._contextMenu._setHandler(item.id(), handler);
    return item;
  }

  /**
   * @param {!Element} element
   * @return {!Item}
   */
  appendCustomItem(element) {
    const item = new Item(this._contextMenu, 'item', '<custom>');
    item._customElement = element;
    this._items.push(item);
    return item;
  }

  /**
   * @param {string} actionId
   * @param {string=} label
   * @param {boolean=} optional
   */
  appendAction(actionId, label, optional) {
    const action = UI.actionRegistry.action(actionId);
    if (!action) {
      if (!optional) {
        console.error(`Action ${actionId} was not defined`);
      }
      return;
    }
    if (!label) {
      label = action.title();
    }
    const result = this.appendItem(label, action.execute.bind(action));
    const shortcut = UI.shortcutRegistry.shortcutTitleForAction(actionId);
    if (shortcut) {
      result.setShortcut(shortcut);
    }
  }

  /**
   * @param {string} label
   * @param {boolean=} disabled
   * @return {!SubMenu}
   */
  appendSubMenuItem(label, disabled) {
    const item = new SubMenu(this._contextMenu, label, disabled);
    item._init();
    this._items.push(item);
    return item;
  }

  /**
   * @param {string} label
   * @param {function()} handler
   * @param {boolean=} checked
   * @param {boolean=} disabled
   * @return {!Item}
   */
  appendCheckboxItem(label, handler, checked, disabled) {
    const item = new Item(this._contextMenu, 'checkbox', label, disabled, checked);
    this._items.push(item);
    this._contextMenu._setHandler(item.id(), handler);
    return item;
  }
}

/**
 * @unrestricted
 */
class SubMenu extends Item {
  /**
   * @param {?ContextMenu} contextMenu
   * @param {string=} label
   * @param {boolean=} disabled
   */
  constructor(contextMenu, label, disabled) {
    super(contextMenu, 'subMenu', label, disabled);
    /** @type {!Map<string, !Section>} */
    this._sections = new Map();
    /** @type {!Array<!Section>} */
    this._sectionList = [];
  }

  _init() {
    _groupWeights.forEach(name => this.section(name));
  }

  /**
   * @param {string=} name
   * @return {!Section}
   */
  section(name) {
    let section = name ? this._sections.get(name) : null;
    if (!section) {
      section = new Section$1(this._contextMenu);
      if (name) {
        this._sections.set(name, section);
        this._sectionList.push(section);
      } else {
        this._sectionList.splice(ContextMenu._groupWeights.indexOf('default'), 0, section);
      }
    }
    return section;
  }

  /**
   * @return {!Section}
   */
  headerSection() {
    return this.section('header');
  }

  /**
   * @return {!Section}
   */
  newSection() {
    return this.section('new');
  }

  /**
   * @return {!Section}
   */
  revealSection() {
    return this.section('reveal');
  }

  /**
   * @return {!Section}
   */
  clipboardSection() {
    return this.section('clipboard');
  }

  /**
   * @return {!Section}
   */
  editSection() {
    return this.section('edit');
  }

  /**
   * @return {!Section}
   */
  debugSection() {
    return this.section('debug');
  }

  /**
   * @return {!Section}
   */
  viewSection() {
    return this.section('view');
  }

  /**
   * @return {!Section}
   */
  defaultSection() {
    return this.section('default');
  }

  /**
   * @return {!Section}
   */
  saveSection() {
    return this.section('save');
  }

  /**
   * @return {!Section}
   */
  footerSection() {
    return this.section('footer');
  }

  /**
   * @override
   * @return {!InspectorFrontendHostAPI.ContextMenuDescriptor}
   */
  _buildDescriptor() {
    /** @type {!InspectorFrontendHostAPI.ContextMenuDescriptor} */
    const result = {type: 'subMenu', label: this._label, enabled: !this._disabled, subItems: []};

    const nonEmptySections = this._sectionList.filter(section => !!section._items.length);
    for (const section of nonEmptySections) {
      for (const item of section._items) {
        result.subItems.push(item._buildDescriptor());
      }
      if (section !== nonEmptySections.peekLast()) {
        result.subItems.push({type: 'separator'});
      }
    }
    return result;
  }

  /**
   * @param {string} location
   */
  appendItemsAtLocation(location) {
    for (const extension of self.runtime.extensions('context-menu-item')) {
      const itemLocation = extension.descriptor()['location'] || '';
      if (!itemLocation.startsWith(location + '/')) {
        continue;
      }

      const section = itemLocation.substr(location.length + 1);
      if (!section || section.includes('/')) {
        continue;
      }

      this.section(section).appendAction(extension.descriptor()['actionId']);
    }
  }
}

Item._uniqueSectionName = 0;

/**
 * @unrestricted
 */
class ContextMenu extends SubMenu {
  /**
   * @param {!Event} event
   * @param {boolean=} useSoftMenu
   * @param {number=} x
   * @param {number=} y
   */
  constructor(event, useSoftMenu, x, y) {
    super(null);
    this._contextMenu = this;
    super._init();
    this._defaultSection = this.defaultSection();
    /** @type {!Array.<!Promise.<!Array.<!Provider>>>} */
    this._pendingPromises = [];
    /** @type {!Array<!Object>} */
    this._pendingTargets = [];
    this._event = event;
    this._useSoftMenu = !!useSoftMenu;
    this._x = x === undefined ? event.x : x;
    this._y = y === undefined ? event.y : y;
    this._handlers = {};
    this._id = 0;

    const target = event.deepElementFromPoint();
    if (target) {
      this.appendApplicableItems(/** @type {!Object} */ (target));
    }
  }

  static initialize() {
    Host.InspectorFrontendHost.events.addEventListener(
        Host.InspectorFrontendHostAPI.Events.SetUseSoftMenu, setUseSoftMenu);
    /**
     * @param {!Common.Event} event
     */
    function setUseSoftMenu(event) {
      ContextMenu._useSoftMenu = /** @type {boolean} */ (event.data);
    }
  }

  /**
   * @param {!Document} doc
   */
  static installHandler(doc) {
    doc.body.addEventListener('contextmenu', handler, false);

    /**
     * @param {!Event} event
     */
    function handler(event) {
      const contextMenu = new ContextMenu(event);
      contextMenu.show();
    }
  }

  /**
   * @return {number}
   */
  _nextId() {
    return this._id++;
  }

  show() {
    Promise.all(this._pendingPromises).then(populate.bind(this)).then(this._innerShow.bind(this));
    ContextMenu._pendingMenu = this;

    /**
     * @param {!Array.<!Array.<!Provider>>} appendCallResults
     * @this {ContextMenu}
     */
    function populate(appendCallResults) {
      if (ContextMenu._pendingMenu !== this) {
        return;
      }
      delete ContextMenu._pendingMenu;

      for (let i = 0; i < appendCallResults.length; ++i) {
        const providers = appendCallResults[i];
        const target = this._pendingTargets[i];

        for (let j = 0; j < providers.length; ++j) {
          const provider = /** @type {!Provider} */ (providers[j]);
          provider.appendApplicableItems(this._event, this, target);
        }
      }

      this._pendingPromises = [];
      this._pendingTargets = [];
    }

    this._event.consume(true);
  }

  discard() {
    if (this._softMenu) {
      this._softMenu.discard();
    }
  }

  _innerShow() {
    const menuObject = this._buildMenuDescriptors();
    if (this._useSoftMenu || ContextMenu._useSoftMenu || Host.InspectorFrontendHost.isHostedMode()) {
      this._softMenu = new UI.SoftContextMenu(menuObject, this._itemSelected.bind(this));
      this._softMenu.show(this._event.target.ownerDocument, new AnchorBox(this._x, this._y, 0, 0));
    } else {
      Host.InspectorFrontendHost.showContextMenuAtPoint(this._x, this._y, menuObject, this._event.target.ownerDocument);

      /**
       * @this {ContextMenu}
       */
      function listenToEvents() {
        Host.InspectorFrontendHost.events.addEventListener(
            Host.InspectorFrontendHostAPI.Events.ContextMenuCleared, this._menuCleared, this);
        Host.InspectorFrontendHost.events.addEventListener(
            Host.InspectorFrontendHostAPI.Events.ContextMenuItemSelected, this._onItemSelected, this);
      }

      // showContextMenuAtPoint call above synchronously issues a clear event for previous context menu (if any),
      // so we skip it before subscribing to the clear event.
      setImmediate(listenToEvents.bind(this));
    }
  }

  /**
   * @param {number} x
   */
  setX(x) {
    this._x = x;
  }

  /**
   * @param {number} y
   */
  setY(y) {
    this._y = y;
  }

  /**
   * @param {number} id
   * @param {function(?)} handler
   */
  _setHandler(id, handler) {
    if (handler) {
      this._handlers[id] = handler;
    }
  }

  /**
   * @return {!Array.<!InspectorFrontendHostAPI.ContextMenuDescriptor>}
   */
  _buildMenuDescriptors() {
    return /** @type {!Array.<!InspectorFrontendHostAPI.ContextMenuDescriptor>} */ (super._buildDescriptor().subItems);
  }

  /**
   * @param {!Common.Event} event
   */
  _onItemSelected(event) {
    this._itemSelected(/** @type {string} */ (event.data));
  }

  /**
   * @param {string} id
   */
  _itemSelected(id) {
    if (this._handlers[id]) {
      this._handlers[id].call(this);
    }
    this._menuCleared();
  }

  _menuCleared() {
    Host.InspectorFrontendHost.events.removeEventListener(
        Host.InspectorFrontendHostAPI.Events.ContextMenuCleared, this._menuCleared, this);
    Host.InspectorFrontendHost.events.removeEventListener(
        Host.InspectorFrontendHostAPI.Events.ContextMenuItemSelected, this._onItemSelected, this);
  }

  /**
   * @param {!Object} target
   * @return {boolean}
   */
  containsTarget(target) {
    return this._pendingTargets.indexOf(target) >= 0;
  }

  /**
   * @param {!Object} target
   */
  appendApplicableItems(target) {
    this._pendingPromises.push(self.runtime.allInstances(Provider$1, target));
    this._pendingTargets.push(target);
  }
}

const _groupWeights =
    ['header', 'new', 'reveal', 'edit', 'clipboard', 'debug', 'view', 'default', 'save', 'footer'];

/**
 * @interface
 */
class Provider$1 {
  /**
   * @param {!Event} event
   * @param {!ContextMenu} contextMenu
   * @param {!Object} target
   */
  appendApplicableItems(event, contextMenu, target) {}
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ContextMenu = ContextMenu;

ContextMenu._groupWeights = _groupWeights;

/**
 * @constructor
 */
UI.ContextMenuItem = Item;

/**
 * @constructor
 */
UI.ContextMenuSection = Section$1;

/** @constructor */
UI.ContextSubMenu = SubMenu;

/**
 * @interface
 */
UI.ContextMenu.Provider = Provider$1;

var ContextMenu$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  Item: Item,
  Section: Section$1,
  SubMenu: SubMenu,
  'default': ContextMenu,
  _groupWeights: _groupWeights,
  Provider: Provider$1
});

/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

class Dialog extends UI.GlassPane {
  constructor() {
    super();
    this.registerRequiredCSS('ui/dialog.css');
    this.contentElement.tabIndex = 0;
    this.contentElement.addEventListener('focus', () => this.widget().focus(), false);
    this.contentElement.addEventListener('keydown', this._onKeyDown.bind(this), false);
    this.widget().setDefaultFocusedElement(this.contentElement);
    this.setPointerEventsBehavior(UI.GlassPane.PointerEventsBehavior.BlockedByGlassPane);
    this.setOutsideClickCallback(event => {
      this.hide();
      event.consume(true);
    });
    UI.ARIAUtils.markAsModalDialog(this.contentElement);
    /** @type {!Map<!HTMLElement, number>} */
    this._tabIndexMap = new Map();
    /** @type {?UI.WidgetFocusRestorer} */
    this._focusRestorer = null;
    this._closeOnEscape = true;
  }

  /**
   * @return {boolean}
   */
  static hasInstance() {
    return !!UI.Dialog._instance;
  }

  /**
   * @override
   * @param {!Document|!Element=} where
   */
  show(where) {
    const document = /** @type {!Document} */ (
        where instanceof Document ? where : (where || UI.inspectorView.element).ownerDocument);
    if (UI.Dialog._instance) {
      UI.Dialog._instance.hide();
    }
    UI.Dialog._instance = this;
    this._disableTabIndexOnElements(document);
    super.show(document);
    this._focusRestorer = new UI.WidgetFocusRestorer(this.widget());
  }

  /**
   * @override
   */
  hide() {
    this._focusRestorer.restore();
    super.hide();
    this._restoreTabIndexOnElements();
    delete UI.Dialog._instance;
  }

  /**
   * @param {boolean} close
   */
  setCloseOnEscape(close) {
    this._closeOnEscape = close;
  }

  addCloseButton() {
    const closeButton = this.contentElement.createChild('div', 'dialog-close-button', 'dt-close-button');
    closeButton.gray = true;
    closeButton.addEventListener('click', () => this.hide(), false);
  }

  /**
   * @param {!Document} document
   */
  _disableTabIndexOnElements(document) {
    this._tabIndexMap.clear();
    for (let node = document; node; node = node.traverseNextNode(document)) {
      if (node instanceof HTMLElement) {
        const element = /** @type {!HTMLElement} */ (node);
        const tabIndex = element.tabIndex;
        if (tabIndex >= 0) {
          this._tabIndexMap.set(element, tabIndex);
          element.tabIndex = -1;
        }
      }
    }
  }

  _restoreTabIndexOnElements() {
    for (const element of this._tabIndexMap.keys()) {
      element.tabIndex = /** @type {number} */ (this._tabIndexMap.get(element));
    }
    this._tabIndexMap.clear();
  }

  /**
   * @param {!Event} event
   */
  _onKeyDown(event) {
    if (this._closeOnEscape && event.keyCode === UI.KeyboardShortcut.Keys.Esc.code &&
        UI.KeyboardShortcut.hasNoModifiers(event)) {
      event.consume(true);
      this.hide();
    }
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Dialog = Dialog;

var Dialog$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Dialog
});

// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class DropTarget {
  /**
   * @param {!Element} element
   * @param {!Array<{kind: string, type: !RegExp}>} transferTypes
   * @param {string} messageText
   * @param {function(!DataTransfer)} handleDrop
   */
  constructor(element, transferTypes, messageText, handleDrop) {
    element.addEventListener('dragenter', this._onDragEnter.bind(this), true);
    element.addEventListener('dragover', this._onDragOver.bind(this), true);
    this._element = element;
    this._transferTypes = transferTypes;
    this._messageText = messageText;
    this._handleDrop = handleDrop;
    this._enabled = true;
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  /**
   * @param {!Event} event
   */
  _onDragEnter(event) {
    if (this._enabled && this._hasMatchingType(event)) {
      event.consume(true);
    }
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  _hasMatchingType(event) {
    for (const transferType of this._transferTypes) {
      const found = Array.from(event.dataTransfer.items).find(item => {
        return transferType.kind === item.kind && !!transferType.type.exec(item.type);
      });
      if (found) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {!Event} event
   */
  _onDragOver(event) {
    if (!this._enabled || !this._hasMatchingType(event)) {
      return;
    }
    event.dataTransfer.dropEffect = 'copy';
    event.consume(true);
    if (this._dragMaskElement) {
      return;
    }
    this._dragMaskElement = this._element.createChild('div', '');
    const shadowRoot = UI.createShadowRootWithCoreStyles(this._dragMaskElement, 'ui/dropTarget.css');
    shadowRoot.createChild('div', 'drop-target-message').textContent = this._messageText;
    this._dragMaskElement.addEventListener('drop', this._onDrop.bind(this), true);
    this._dragMaskElement.addEventListener('dragleave', this._onDragLeave.bind(this), true);
  }

  /**
   * @param {!Event} event
   */
  _onDrop(event) {
    event.consume(true);
    this._removeMask();
    if (this._enabled) {
      this._handleDrop(event.dataTransfer);
    }
  }

  /**
   * @param {!Event} event
   */
  _onDragLeave(event) {
    event.consume(true);
    this._removeMask();
  }

  _removeMask() {
    this._dragMaskElement.remove();
    delete this._dragMaskElement;
  }
}

const Type$1 = {
  URI: {kind: 'string', type: /text\/uri-list/},
  Folder: {kind: 'file', type: /$^/},
  File: {kind: 'file', type: /.*/},
  WebFile: {kind: 'file', type: /[\w]+/},
  ImageFile: {kind: 'file', type: /image\/.*/},
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.DropTarget = DropTarget;

UI.DropTarget.Type = Type$1;

var DropTarget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': DropTarget,
  Type: Type$1
});

/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class EmptyWidget extends UI.VBox {
  /**
   * @param {string} text
   */
  constructor(text) {
    super();
    this.registerRequiredCSS('ui/emptyWidget.css');
    this.element.classList.add('empty-view-scroller');
    this._contentElement = this.element.createChild('div', 'empty-view');
    this._textElement = this._contentElement.createChild('div', 'empty-bold-text');
    this._textElement.textContent = text;
  }

  /**
   * @return {!Element}
   */
  appendParagraph() {
    return this._contentElement.createChild('p');
  }

  /**
   * @param {string} link
   * @return {!Node}
   */
  appendLink(link) {
    return this._contentElement.appendChild(UI.XLink.create(link, 'Learn more'));
  }

  /**
   * @param {string} text
   */
  set text(text) {
    this._textElement.textContent = text;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.EmptyWidget = EmptyWidget;

var EmptyWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': EmptyWidget
});

/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class FilterBar extends UI.HBox {
  /**
   * @param {string} name
   * @param {boolean=} visibleByDefault
   */
  constructor(name, visibleByDefault) {
    super();
    this.registerRequiredCSS('ui/filter.css');
    this._enabled = true;
    this.element.classList.add('filter-bar');

    this._stateSetting = Common.settings.createSetting('filterBar-' + name + '-toggled', !!visibleByDefault);
    this._filterButton = new UI.ToolbarSettingToggle(this._stateSetting, 'largeicon-filter', Common.UIString('Filter'));

    this._filters = [];

    this._updateFilterBar();
    this._stateSetting.addChangeListener(this._updateFilterBar.bind(this));
  }

  /**
   * @return {!UI.ToolbarButton}
   */
  filterButton() {
    return this._filterButton;
  }

  /**
   * @param {!FilterUI} filter
   */
  addFilter(filter) {
    this._filters.push(filter);
    this.element.appendChild(filter.element());
    filter.addEventListener(FilterUI.Events.FilterChanged, this._filterChanged, this);
    this._updateFilterButton();
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    this._filterButton.setEnabled(enabled);
    this._updateFilterBar();
  }

  forceShowFilterBar() {
    this._alwaysShowFilters = true;
    this._updateFilterBar();
  }

  showOnce() {
    this._stateSetting.set(true);
  }

  /**
   * @param {!Common.Event} event
   */
  _filterChanged(event) {
    this._updateFilterButton();
  }

  /**
   * @override
   */
  wasShown() {
    super.wasShown();
    this._updateFilterBar();
  }

  _updateFilterBar() {
    if (!this.parentWidget() || this._showingWidget) {
      return;
    }
    if (this.visible()) {
      this._showingWidget = true;
      this.showWidget();
      this._showingWidget = false;
    } else {
      this.hideWidget();
    }
  }

  /**
   * @override
   */
  focus() {
    for (let i = 0; i < this._filters.length; ++i) {
      if (this._filters[i] instanceof TextFilterUI) {
        const textFilterUI = /** @type {!TextFilterUI} */ (this._filters[i]);
        textFilterUI.focus();
        break;
      }
    }
  }

  _updateFilterButton() {
    let isActive = false;
    for (const filter of this._filters) {
      isActive = isActive || filter.isActive();
    }
    this._filterButton.setDefaultWithRedColor(isActive);
    this._filterButton.setToggleWithRedColor(isActive);
  }

  clear() {
    this.element.removeChildren();
    this._filters = [];
    this._updateFilterButton();
  }

  setting() {
    return this._stateSetting;
  }

  visible() {
    return this._alwaysShowFilters || (this._stateSetting.get() && this._enabled);
  }
}

/**
 * @interface
 */
class FilterUI extends Common.EventTarget {
  /**
   * @return {boolean}
   */
  isActive() {
  }

  /**
   * @return {!Element}
   */
  element() {}
}

/** @enum {symbol} */
FilterUI.Events = {
  FilterChanged: Symbol('FilterChanged')
};

/**
 * @implements {UI.FilterUI}
 * @unrestricted
 */
class TextFilterUI extends Common.Object {
  constructor() {
    super();
    this._filterElement = createElement('div');
    this._filterElement.className = 'filter-text-filter';

    this._filterInputElement = this._filterElement.createChild('span', 'filter-input-field');

    this._prompt = new UI.TextPrompt();
    this._prompt.initialize(this._completions.bind(this), ' ');
    this._proxyElement = this._prompt.attach(this._filterInputElement);
    this._proxyElement.title = Common.UIString('e.g. /small[\\d]+/ url:a.com/b');
    this._prompt.setPlaceholder(Common.UIString('Filter'));
    this._prompt.addEventListener(UI.TextPrompt.Events.TextChanged, this._valueChanged.bind(this));

    /** @type {?function(string, string, boolean=):!Promise<!UI.SuggestBox.Suggestions>} */
    this._suggestionProvider = null;
  }

  /**
   * @param {string} expression
   * @param {string} prefix
   * @param {boolean=} force
   * @return {!Promise<!UI.SuggestBox.Suggestions>}
   */
  _completions(expression, prefix, force) {
    if (this._suggestionProvider) {
      return this._suggestionProvider(expression, prefix, force);
    }
    return Promise.resolve([]);
  }
  /**
   * @override
   * @return {boolean}
   */
  isActive() {
    return !!this._prompt.text();
  }

  /**
   * @override
   * @return {!Element}
   */
  element() {
    return this._filterElement;
  }

  /**
   * @return {string}
   */
  value() {
    return this._prompt.textWithCurrentSuggestion();
  }

  /**
   * @param {string} value
   */
  setValue(value) {
    this._prompt.setText(value);
    this._valueChanged();
  }

  focus() {
    this._filterInputElement.focus();
  }

  /**
   * @param {(function(string, string, boolean=):!Promise<!UI.SuggestBox.Suggestions>)} suggestionProvider
   */
  setSuggestionProvider(suggestionProvider) {
    this._prompt.clearAutocomplete();
    this._suggestionProvider = suggestionProvider;
  }

  _valueChanged() {
    this.dispatchEventToListeners(FilterUI.Events.FilterChanged, null);
  }
}

/**
 * @implements {FilterUI}
 * @unrestricted
 */
class NamedBitSetFilterUI extends Common.Object {
  /**
   * @param {!Array.<!UI.NamedBitSetFilterUI.Item>} items
   * @param {!Common.Setting=} setting
   */
  constructor(items, setting) {
    super();
    this._filtersElement = createElementWithClass('div', 'filter-bitset-filter');
    UI.ARIAUtils.markAsListBox(this._filtersElement);
    UI.ARIAUtils.markAsMultiSelectable(this._filtersElement);
    this._filtersElement.title = Common.UIString(
        '%sClick to select multiple types',
        UI.KeyboardShortcut.shortcutToString('', UI.KeyboardShortcut.Modifiers.CtrlOrMeta));

    this._allowedTypes = {};
    /** @type {!Array.<!Element>} */
    this._typeFilterElements = [];
    this._addBit(NamedBitSetFilterUI.ALL_TYPES, Common.UIString('All'));
    this._typeFilterElements[0].tabIndex = 0;
    this._filtersElement.createChild('div', 'filter-bitset-filter-divider');

    for (let i = 0; i < items.length; ++i) {
      this._addBit(items[i].name, items[i].label, items[i].title);
    }

    if (setting) {
      this._setting = setting;
      setting.addChangeListener(this._settingChanged.bind(this));
      this._settingChanged();
    } else {
      this._toggleTypeFilter(NamedBitSetFilterUI.ALL_TYPES, false /* allowMultiSelect */);
    }
  }

  reset() {
    this._toggleTypeFilter(NamedBitSetFilterUI.ALL_TYPES, false /* allowMultiSelect */);
  }

  /**
   * @override
   * @return {boolean}
   */
  isActive() {
    return !this._allowedTypes[NamedBitSetFilterUI.ALL_TYPES];
  }

  /**
   * @override
   * @return {!Element}
   */
  element() {
    return this._filtersElement;
  }

  /**
   * @param {string} typeName
   * @return {boolean}
   */
  accept(typeName) {
    return !!this._allowedTypes[NamedBitSetFilterUI.ALL_TYPES] || !!this._allowedTypes[typeName];
  }

  _settingChanged() {
    const allowedTypes = this._setting.get();
    this._allowedTypes = {};
    for (const element of this._typeFilterElements) {
      if (allowedTypes[element.typeName]) {
        this._allowedTypes[element.typeName] = true;
      }
    }
    this._update();
  }

  _update() {
    if ((Object.keys(this._allowedTypes).length === 0) || this._allowedTypes[NamedBitSetFilterUI.ALL_TYPES]) {
      this._allowedTypes = {};
      this._allowedTypes[NamedBitSetFilterUI.ALL_TYPES] = true;
    }
    for (const element of this._typeFilterElements) {
      const typeName = element.typeName;
      const active = !!this._allowedTypes[typeName];
      element.classList.toggle('selected', active);
      UI.ARIAUtils.setSelected(element, active);
    }
    this.dispatchEventToListeners(FilterUI.Events.FilterChanged, null);
  }

  /**
   * @param {string} name
   * @param {string} label
   * @param {string=} title
   */
  _addBit(name, label, title) {
    const typeFilterElement = this._filtersElement.createChild('span', name);
    typeFilterElement.tabIndex = -1;
    typeFilterElement.typeName = name;
    typeFilterElement.createTextChild(label);
    UI.ARIAUtils.markAsOption(typeFilterElement);
    if (title) {
      typeFilterElement.title = title;
    }
    typeFilterElement.addEventListener('click', this._onTypeFilterClicked.bind(this), false);
    typeFilterElement.addEventListener('keydown', this._onTypeFilterKeydown.bind(this), false);
    this._typeFilterElements.push(typeFilterElement);
  }

  /**
   * @param {!Event} e
   */
  _onTypeFilterClicked(e) {
    let toggle;
    if (Host.isMac()) {
      toggle = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    } else {
      toggle = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    }
    this._toggleTypeFilter(e.target.typeName, toggle);
  }

  /**
   * @param {!Event} event
   */
  _onTypeFilterKeydown(event) {
    const element = /** @type {?Element} */ (event.target);
    if (!element) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      if (this._keyFocusNextBit(element, true /* selectPrevious */)) {
        event.consume(true);
      }
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      if (this._keyFocusNextBit(element, false /* selectPrevious */)) {
        event.consume(true);
      }
    } else if (isEnterOrSpaceKey(event)) {
      this._onTypeFilterClicked(event);
    }
  }

  /**
   * @param {!Element} target
   * @param {boolean} selectPrevious
   * @returns {!boolean}
   */
  _keyFocusNextBit(target, selectPrevious) {
    const index = this._typeFilterElements.indexOf(target);
    if (index === -1) {
      return false;
    }
    const nextIndex = selectPrevious ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= this._typeFilterElements.length) {
      return false;
    }

    const nextElement = this._typeFilterElements[nextIndex];
    nextElement.tabIndex = 0;
    target.tabIndex = -1;
    nextElement.focus();
    return true;
  }

  /**
   * @param {string} typeName
   * @param {boolean} allowMultiSelect
   */
  _toggleTypeFilter(typeName, allowMultiSelect) {
    if (allowMultiSelect && typeName !== NamedBitSetFilterUI.ALL_TYPES) {
      this._allowedTypes[NamedBitSetFilterUI.ALL_TYPES] = false;
    } else {
      this._allowedTypes = {};
    }

    this._allowedTypes[typeName] = !this._allowedTypes[typeName];

    if (this._setting) {
      this._setting.set(this._allowedTypes);
    } else {
      this._update();
    }
  }
}

NamedBitSetFilterUI.ALL_TYPES = 'all';

/**
 * @implements {UI.FilterUI}
 * @unrestricted
 */
class CheckboxFilterUI extends Common.Object {
  /**
   * @param {string} className
   * @param {string} title
   * @param {boolean=} activeWhenChecked
   * @param {!Common.Setting=} setting
   */
  constructor(className, title, activeWhenChecked, setting) {
    super();
    this._filterElement = createElementWithClass('div', 'filter-checkbox-filter');
    this._activeWhenChecked = !!activeWhenChecked;
    this._label = UI.CheckboxLabel.create(title);
    this._filterElement.appendChild(this._label);
    this._checkboxElement = this._label.checkboxElement;
    if (setting) {
      UI.SettingsUI.bindCheckbox(this._checkboxElement, setting);
    } else {
      this._checkboxElement.checked = true;
    }
    this._checkboxElement.addEventListener('change', this._fireUpdated.bind(this), false);
  }

  /**
   * @override
   * @return {boolean}
   */
  isActive() {
    return this._activeWhenChecked === this._checkboxElement.checked;
  }

  /**
   * @return {boolean}
   */
  checked() {
    return this._checkboxElement.checked;
  }

  /**
   * @param {boolean} checked
   */
  setChecked(checked) {
    this._checkboxElement.checked = checked;
  }

  /**
   * @override
   * @return {!Element}
   */
  element() {
    return this._filterElement;
  }

  /**
   * @return {!Element}
   */
  labelElement() {
    return this._label;
  }

  _fireUpdated() {
    this.dispatchEventToListeners(FilterUI.Events.FilterChanged, null);
  }

  /**
   * @param {string} backgroundColor
   * @param {string} borderColor
   */
  setColor(backgroundColor, borderColor) {
    this._label.backgroundColor = backgroundColor;
    this._label.borderColor = borderColor;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.FilterBar = FilterBar;

/** @interface */
UI.FilterUI = FilterUI;

/** @constructor */
UI.TextFilterUI = TextFilterUI;

/** @constructor */
UI.NamedBitSetFilterUI = NamedBitSetFilterUI;

/** @constructor */
UI.CheckboxFilterUI = CheckboxFilterUI;

/** @typedef {{name: string, label: string, title: (string|undefined)}} */
UI.NamedBitSetFilterUI.Item;

var FilterBar$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': FilterBar,
  FilterUI: FilterUI,
  TextFilterUI: TextFilterUI,
  NamedBitSetFilterUI: NamedBitSetFilterUI,
  CheckboxFilterUI: CheckboxFilterUI
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class FilterSuggestionBuilder {
  /**
   * @param {!Array<string>} keys
   * @param {function(string, !Array<string>)=} valueSorter
   */
  constructor(keys, valueSorter) {
    this._keys = keys;
    this._valueSorter = valueSorter || ((key, result) => result.sort());
    /** @type {!Map<string, !Set<string>>} */
    this._valuesMap = new Map();
  }

  /**
   * @param {string} expression
   * @param {string} prefix
   * @param {boolean=} force
   * @return {!Promise<!UI.SuggestBox.Suggestions>}
   */
  completions(expression, prefix, force) {
    if (!prefix && !force) {
      return Promise.resolve([]);
    }

    const negative = prefix.startsWith('-');
    if (negative) {
      prefix = prefix.substring(1);
    }
    const modifier = negative ? '-' : '';
    const valueDelimiterIndex = prefix.indexOf(':');

    const suggestions = [];
    if (valueDelimiterIndex === -1) {
      const matcher = new RegExp('^' + prefix.escapeForRegExp(), 'i');
      for (const key of this._keys) {
        if (matcher.test(key)) {
          suggestions.push({text: modifier + key + ':'});
        }
      }
    } else {
      const key = prefix.substring(0, valueDelimiterIndex).toLowerCase();
      const value = prefix.substring(valueDelimiterIndex + 1);
      const matcher = new RegExp('^' + value.escapeForRegExp(), 'i');
      const values = Array.from(this._valuesMap.get(key) || new Set());
      this._valueSorter(key, values);
      for (const item of values) {
        if (matcher.test(item) && (item !== value)) {
          suggestions.push({text: modifier + key + ':' + item});
        }
      }
    }
    return Promise.resolve(suggestions);
  }

  /**
   * @param {string} key
   * @param {?string=} value
   */
  addItem(key, value) {
    if (!value) {
      return;
    }

    if (!this._valuesMap.get(key)) {
      this._valuesMap.set(key, /** @type {!Set<string>} */ (new Set()));
    }
    this._valuesMap.get(key).add(value);
  }

  clear() {
    this._valuesMap.clear();
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.FilterSuggestionBuilder = FilterSuggestionBuilder;

var FilterSuggestionBuilder$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': FilterSuggestionBuilder
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ForwardedInputEventHandler {
  constructor() {
    Host.InspectorFrontendHost.events.addEventListener(
        Host.InspectorFrontendHostAPI.Events.KeyEventUnhandled, this._onKeyEventUnhandled, this);
  }

  /**
   * @param {!Common.Event} event
   */
  _onKeyEventUnhandled(event) {
    const data = event.data;
    const type = /** @type {string} */ (data.type);
    const key = /** @type {string} */ (data.key);
    const keyCode = /** @type {number} */ (data.keyCode);
    const modifiers = /** @type {number} */ (data.modifiers);

    if (type !== 'keydown') {
      return;
    }

    UI.context.setFlavor(UI.ShortcutRegistry.ForwardedShortcut, UI.ShortcutRegistry.ForwardedShortcut.instance);
    UI.shortcutRegistry.handleKey(UI.KeyboardShortcut.makeKey(keyCode, modifiers), key);
    UI.context.setFlavor(UI.ShortcutRegistry.ForwardedShortcut, null);
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ForwardedInputEventHandler = ForwardedInputEventHandler;

/** @type {!ForwardedInputEventHandler} */
UI.forwardedEventHandler = new UI.ForwardedInputEventHandler();

var ForwardedInputEventHandler$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ForwardedInputEventHandler
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class Fragment {
  /**
   * @param {!Element} element
   */
  constructor(element) {
    this._element = element;

    /** @type {!Map<string, !Element>} */
    this._elementsById = new Map();
  }

  /**
   * @return {!Element}
   */
  element() {
    return this._element;
  }

  /**
   * @param {string} elementId
   * @return {!Element}
   */
  $(elementId) {
    return this._elementsById.get(elementId);
  }

  /**
   * @param {!Array<string>} strings
   * @param {...*} values
   * @return {!Fragment}
   */
  static build(strings, ...values) {
    return Fragment._render(Fragment._template(strings), values);
  }

  /**
   * @param {!Array<string>} strings
   * @param {...*} values
   * @return {!Fragment}
   */
  static cached(strings, ...values) {
    let template = Fragment._templateCache.get(strings);
    if (!template) {
      template = Fragment._template(strings);
      Fragment._templateCache.set(strings, template);
    }
    return Fragment._render(template, values);
  }

  /**
   * @param {!Array<string>} strings
   * @return {!Fragment._Template}
   * @suppressGlobalPropertiesCheck
   */
  static _template(strings) {
    let html = '';
    let insideText = true;
    for (let i = 0; i < strings.length - 1; i++) {
      html += strings[i];
      const close = strings[i].lastIndexOf('>');
      const open = strings[i].indexOf('<', close + 1);
      if (close !== -1 && open === -1) {
        insideText = true;
      } else if (open !== -1) {
        insideText = false;
      }
      html += insideText ? Fragment._textMarker : Fragment._attributeMarker(i);
    }
    html += strings[strings.length - 1];

    const template = window.document.createElement('template');
    template.innerHTML = html;
    const walker = template.ownerDocument.createTreeWalker(
        template.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
    let valueIndex = 0;
    const emptyTextNodes = [];
    const binds = [];
    const nodesToMark = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttributes()) {
        if (node.hasAttribute('$')) {
          nodesToMark.push(node);
          binds.push({elementId: node.getAttribute('$')});
          node.removeAttribute('$');
        }

        const attributesToRemove = [];
        for (let i = 0; i < node.attributes.length; i++) {
          const name = node.attributes[i].name;

          if (!Fragment._attributeMarkerRegex.test(name) &&
              !Fragment._attributeMarkerRegex.test(node.attributes[i].value)) {
            continue;
          }

          attributesToRemove.push(name);
          nodesToMark.push(node);
          const bind = {attr: {index: valueIndex}};
          bind.attr.names = name.split(Fragment._attributeMarkerRegex);
          valueIndex += bind.attr.names.length - 1;
          bind.attr.values = node.attributes[i].value.split(Fragment._attributeMarkerRegex);
          valueIndex += bind.attr.values.length - 1;
          binds.push(bind);
        }
        for (let i = 0; i < attributesToRemove.length; i++) {
          node.removeAttribute(attributesToRemove[i]);
        }
      }

      if (node.nodeType === Node.TEXT_NODE && node.data.indexOf(Fragment._textMarker) !== -1) {
        const texts = node.data.split(Fragment._textMarkerRegex);
        node.data = texts[texts.length - 1];
        for (let i = 0; i < texts.length - 1; i++) {
          if (texts[i]) {
            node.parentNode.insertBefore(createTextNode(texts[i]), node);
          }
          const nodeToReplace = createElement('span');
          nodesToMark.push(nodeToReplace);
          binds.push({replaceNodeIndex: valueIndex++});
          node.parentNode.insertBefore(nodeToReplace, node);
        }
      }

      if (node.nodeType === Node.TEXT_NODE &&
          (!node.previousSibling || node.previousSibling.nodeType === Node.ELEMENT_NODE) &&
          (!node.nextSibling || node.nextSibling.nodeType === Node.ELEMENT_NODE) && /^\s*$/.test(node.data)) {
        emptyTextNodes.push(node);
      }
    }

    for (let i = 0; i < nodesToMark.length; i++) {
      nodesToMark[i].classList.add(Fragment._class(i));
    }

    for (const emptyTextNode of emptyTextNodes) {
      emptyTextNode.remove();
    }
    return {template: template, binds: binds};
  }

  /**
   * @param {!Fragment._Template} template
   * @param {!Array<*>} values
   * @return {!Fragment}
   */
  static _render(template, values) {
    const content = template.template.ownerDocument.importNode(template.template.content, true);
    const resultElement =
        /** @type {!Element} */ (content.firstChild === content.lastChild ? content.firstChild : content);
    const result = new Fragment(resultElement);

    const boundElements = [];
    for (let i = 0; i < template.binds.length; i++) {
      const className = Fragment._class(i);
      const element = /** @type {!Element} */ (content.querySelector('.' + className));
      element.classList.remove(className);
      boundElements.push(element);
    }

    for (let bindIndex = 0; bindIndex < template.binds.length; bindIndex++) {
      const bind = template.binds[bindIndex];
      const element = boundElements[bindIndex];
      if ('elementId' in bind) {
        result._elementsById.set(/** @type {string} */ (bind.elementId), element);
      } else if ('replaceNodeIndex' in bind) {
        const value = values[/** @type {number} */ (bind.replaceNodeIndex)];
        element.parentNode.replaceChild(this._nodeForValue(value), element);
      } else if ('attr' in bind) {
        if (bind.attr.names.length === 2 && bind.attr.values.length === 1 &&
            typeof values[bind.attr.index] === 'function') {
          values[bind.attr.index].call(null, element);
        } else {
          let name = bind.attr.names[0];
          for (let i = 1; i < bind.attr.names.length; i++) {
            name += values[bind.attr.index + i - 1];
            name += bind.attr.names[i];
          }
          if (name) {
            let value = bind.attr.values[0];
            for (let i = 1; i < bind.attr.values.length; i++) {
              value += values[bind.attr.index + bind.attr.names.length - 1 + i - 1];
              value += bind.attr.values[i];
            }
            element.setAttribute(name, value);
          }
        }
      } else {
        throw new Error('Unexpected bind');
      }
    }
    return result;
  }

  /**
   * @param {*} value
   * @return {!Node}
   */
  static _nodeForValue(value) {
    if (value instanceof Node) {
      return value;
    }
    if (value instanceof Fragment) {
      return value._element;
    }
    if (Array.isArray(value)) {
      const node = createDocumentFragment();
      for (const v of value) {
        node.appendChild(this._nodeForValue(v));
      }
      return node;
    }
    return createTextNode('' + value);
  }
}

const _textMarker = '{{template-text}}';
const _textMarkerRegex = /{{template-text}}/;
const _attributeMarker = index => 'template-attribute' + index;
const _attributeMarkerRegex = /template-attribute\d+/;
const _class = index => 'template-class-' + index;
const _templateCache = new Map();

/**
 * @param {!Array<string>} strings
 * @param {...*} vararg
 * @return {!Element}
 */
const html = (strings, ...vararg) => {
  return Fragment.cached(strings, ...vararg).element();
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Fragment = Fragment;

UI.Fragment._textMarker = _textMarker;
UI.Fragment._textMarkerRegex = _textMarkerRegex;
UI.Fragment._attributeMarker = _attributeMarker;
UI.Fragment._attributeMarkerRegex = _attributeMarkerRegex;
UI.Fragment._class = _class;
UI.Fragment._templateCache = _templateCache;

UI.html = html;

/**
 * @typedef {!{
  *   template: !Element,
  *   binds: !Array<!Fragment._Bind>
  * }}
  */
UI.Fragment._Template;

/**
  * @typedef {!{
  *   elementId: (string|undefined),
  *
  *   attr: (!{
  *     index: number,
  *     names: !Array<string>,
  *     values: !Array<string>
  *   }|undefined),
  *
  *   replaceNodeIndex: (number|undefined)
  * }}
  */
UI.Fragment._Bind;

var Fragment$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Fragment,
  _textMarker: _textMarker,
  _textMarkerRegex: _textMarkerRegex,
  _attributeMarker: _attributeMarker,
  _attributeMarkerRegex: _attributeMarkerRegex,
  _class: _class,
  _templateCache: _templateCache,
  html: html
});

/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const Geometry = {};

/**
 * @type {number}
 */
const _Eps = 1e-5;

/**
 * @unrestricted
 */
class Vector {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /**
   * @return {number}
   */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    const length = this.length();
    if (length <= UI.Geometry._Eps) {
      return;
    }

    this.x /= length;
    this.y /= length;
    this.z /= length;
  }
}

/**
 * @unrestricted
 */
class Point {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * @param {!Point} p
   * @return {number}
   */
  distanceTo(p) {
    return Math.sqrt(Math.pow(p.x - this.x, 2) + Math.pow(p.y - this.y, 2));
  }

  /**
   * @param {!Point} line
   * @return {!Point}
   */
  projectOn(line) {
    if (line.x === 0 && line.y === 0) {
      return new Point(0, 0);
    }
    return line.scale((this.x * line.x + this.y * line.y) / (Math.pow(line.x, 2) + Math.pow(line.y, 2)));
  }

  /**
   * @param {number} scalar
   * @return {!Point}
   */
  scale(scalar) {
    return new Point(this.x * scalar, this.y * scalar);
  }

  /**
   * @override
   * @return {string}
   */
  toString() {
    return Math.round(this.x * 100) / 100 + ', ' + Math.round(this.y * 100) / 100;
  }
}

/**
 * @unrestricted
 */
class CubicBezier {
  /**
   * @param {!Point} point1
   * @param {!Point} point2
   */
  constructor(point1, point2) {
    this.controlPoints = [point1, point2];
  }

  /**
   * @param {string} text
   * @return {?CubicBezier}
   */
  static parse(text) {
    const keywordValues = CubicBezier.KeywordValues;
    const value = text.toLowerCase().replace(/\s+/g, '');
    if (Object.keys(keywordValues).indexOf(value) !== -1) {
      return CubicBezier.parse(keywordValues[value]);
    }
    const bezierRegex = /^cubic-bezier\(([^,]+),([^,]+),([^,]+),([^,]+)\)$/;
    const match = value.match(bezierRegex);
    if (match) {
      const control1 = new Point(parseFloat(match[1]), parseFloat(match[2]));
      const control2 = new Point(parseFloat(match[3]), parseFloat(match[4]));
      return new CubicBezier(control1, control2);
    }
    return null;
  }

  /**
   * @param {number} t
   * @return {!Point}
   */
  evaluateAt(t) {
    /**
     * @param {number} v1
     * @param {number} v2
     * @param {number} t
     */
    function evaluate(v1, v2, t) {
      return 3 * (1 - t) * (1 - t) * t * v1 + 3 * (1 - t) * t * t * v2 + Math.pow(t, 3);
    }

    const x = evaluate(this.controlPoints[0].x, this.controlPoints[1].x, t);
    const y = evaluate(this.controlPoints[0].y, this.controlPoints[1].y, t);
    return new Point(x, y);
  }

  /**
   * @return {string}
   */
  asCSSText() {
    const raw = 'cubic-bezier(' + this.controlPoints.join(', ') + ')';
    const keywordValues = CubicBezier.KeywordValues;
    for (const keyword in keywordValues) {
      if (raw === keywordValues[keyword]) {
        return keyword;
      }
    }
    return raw;
  }
}

/** @type {!RegExp} */
CubicBezier.Regex = /((cubic-bezier\([^)]+\))|\b(linear|ease-in-out|ease-in|ease-out|ease)\b)/g;

CubicBezier.KeywordValues = {
  'linear': 'cubic-bezier(0, 0, 1, 1)',
  'ease': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  'ease-in': 'cubic-bezier(0.42, 0, 1, 1)',
  'ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)',
  'ease-out': 'cubic-bezier(0, 0, 0.58, 1)'
};

/**
 * @unrestricted
 */
class EulerAngles {
  /**
   * @param {number} alpha
   * @param {number} beta
   * @param {number} gamma
   */
  constructor(alpha, beta, gamma) {
    this.alpha = alpha;
    this.beta = beta;
    this.gamma = gamma;
  }

  /**
   * @param {!CSSMatrix} rotationMatrix
   * @return {!EulerAngles}
   */
  static fromRotationMatrix(rotationMatrix) {
    const beta = Math.atan2(rotationMatrix.m23, rotationMatrix.m33);
    const gamma = Math.atan2(
        -rotationMatrix.m13,
        Math.sqrt(rotationMatrix.m11 * rotationMatrix.m11 + rotationMatrix.m12 * rotationMatrix.m12));
    const alpha = Math.atan2(rotationMatrix.m12, rotationMatrix.m11);
    return new EulerAngles(radiansToDegrees(alpha), radiansToDegrees(beta), radiansToDegrees(gamma));
  }

  /**
   * @return {string}
   */
  toRotate3DString() {
    const gammaAxisY = -Math.sin(degreesToRadians(this.beta));
    const gammaAxisZ = Math.cos(degreesToRadians(this.beta));
    const axis = {alpha: [0, 1, 0], beta: [-1, 0, 0], gamma: [0, gammaAxisY, gammaAxisZ]};
    return 'rotate3d(' + axis.alpha.join(',') + ',' + this.alpha + 'deg) ' +
        'rotate3d(' + axis.beta.join(',') + ',' + this.beta + 'deg) ' +
        'rotate3d(' + axis.gamma.join(',') + ',' + this.gamma + 'deg)';
  }
}

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {number}
 */
const scalarProduct = function(u, v) {
  return u.x * v.x + u.y * v.y + u.z * v.z;
};

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {!Vector}
 */
const crossProduct = function(u, v) {
  const x = u.y * v.z - u.z * v.y;
  const y = u.z * v.x - u.x * v.z;
  const z = u.x * v.y - u.y * v.x;
  return new Vector(x, y, z);
};

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {!Vector}
 */
const subtract = function(u, v) {
  const x = u.x - v.x;
  const y = u.y - v.y;
  const z = u.z - v.z;
  return new Vector(x, y, z);
};

/**
 * @param {!Vector} v
 * @param {!CSSMatrix} m
 * @return {!Vector}
 */
const multiplyVectorByMatrixAndNormalize = function(v, m) {
  const t = v.x * m.m14 + v.y * m.m24 + v.z * m.m34 + m.m44;
  const x = (v.x * m.m11 + v.y * m.m21 + v.z * m.m31 + m.m41) / t;
  const y = (v.x * m.m12 + v.y * m.m22 + v.z * m.m32 + m.m42) / t;
  const z = (v.x * m.m13 + v.y * m.m23 + v.z * m.m33 + m.m43) / t;
  return new Vector(x, y, z);
};

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {number}
 */
const calculateAngle = function(u, v) {
  const uLength = u.length();
  const vLength = v.length();
  if (uLength <= _Eps || vLength <= _Eps) {
    return 0;
  }
  const cos = scalarProduct(u, v) / uLength / vLength;
  if (Math.abs(cos) > 1) {
    return 0;
  }
  return radiansToDegrees(Math.acos(cos));
};

/**
 * @param {number} deg
 * @return {number}
 */
const degreesToRadians = function(deg) {
  return deg * Math.PI / 180;
};

/**
 * @param {number} rad
 * @return {number}
 */
const radiansToDegrees = function(rad) {
  return rad * 180 / Math.PI;
};

/**
 * @param {!CSSMatrix} matrix
 * @param {!Array.<number>} points
 * @param {{minX: number, maxX: number, minY: number, maxY: number}=} aggregateBounds
 * @return {!{minX: number, maxX: number, minY: number, maxY: number}}
 */
const boundsForTransformedPoints = function(matrix, points, aggregateBounds) {
  if (!aggregateBounds) {
    aggregateBounds = {minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity};
  }
  if (points.length % 3) {
    console.assert('Invalid size of points array');
  }
  for (let p = 0; p < points.length; p += 3) {
    let vector = new Vector(points[p], points[p + 1], points[p + 2]);
    vector = UI.Geometry.multiplyVectorByMatrixAndNormalize(vector, matrix);
    aggregateBounds.minX = Math.min(aggregateBounds.minX, vector.x);
    aggregateBounds.maxX = Math.max(aggregateBounds.maxX, vector.x);
    aggregateBounds.minY = Math.min(aggregateBounds.minY, vector.y);
    aggregateBounds.maxY = Math.max(aggregateBounds.maxY, vector.y);
  }
  return aggregateBounds;
};

/**
 * @unrestricted
 */
class Size {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  /**
   * @param {?Size} size
   * @return {!Size}
   */
  clipTo(size) {
    if (!size) {
      return this;
    }
    return new Size(Math.min(this.width, size.width), Math.min(this.height, size.height));
  }

  /**
   * @param {number} scale
   * @return {!Size}
   */
  scale(scale) {
    return new Size(this.width * scale, this.height * scale);
  }

  /**
   * @param {?Size} size
   * @return {boolean}
   */
  isEqual(size) {
    return !!size && this.width === size.width && this.height === size.height;
  }

  /**
 * @param {!Size|number} size
 * @return {!Size}
 */
  widthToMax(size) {
    return new Size(Math.max(this.width, (typeof size === 'number' ? size : size.width)), this.height);
  }

  /**
 * @param {!Size|number} size
 * @return {!Size}
 */
  addWidth(size) {
    return new Size(this.width + (typeof size === 'number' ? size : size.width), this.height);
  }

  /**
   * @param {!Size|number} size
   * @return {!Size}
   */
  heightToMax(size) {
    return new Size(this.width, Math.max(this.height, (typeof size === 'number' ? size : size.height)));
  }

  /**
   * @param {!Size|number} size
   * @return {!Size}
   */
  addHeight(size) {
    return new Size(this.width, this.height + (typeof size === 'number' ? size : size.height));
  }
}

/**
 * @unrestricted
 */
class Insets {
  /**
   * @param {number} left
   * @param {number} top
   * @param {number} right
   * @param {number} bottom
   */
  constructor(left, top, right, bottom) {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
  }

  /**
   * @param {?Insets} insets
   * @return {boolean}
   */
  isEqual(insets) {
    return !!insets && this.left === insets.left && this.top === insets.top && this.right === insets.right &&
        this.bottom === insets.bottom;
  }
}

/**
 * @unrestricted
 */
class Rect {
  /**
   * @param {number} left
   * @param {number} top
   * @param {number} width
   * @param {number} height
   */
  constructor(left, top, width, height) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
  }

  /**
   * @param {?Rect} rect
   * @return {boolean}
   */
  isEqual(rect) {
    return !!rect && this.left === rect.left && this.top === rect.top && this.width === rect.width &&
        this.height === rect.height;
  }

  /**
   * @param {number} scale
   * @return {!Rect}
   */
  scale(scale) {
    return new Rect(this.left * scale, this.top * scale, this.width * scale, this.height * scale);
  }

  /**
   * @return {!Size}
   */
  size() {
    return new Size(this.width, this.height);
  }

  /**
   * @param {!Rect} origin
   * @return {!Rect}
   */
  relativeTo(origin) {
    return new Rect(this.left - origin.left, this.top - origin.top, this.width, this.height);
  }

  /**
   * @param {!Rect} origin
   * @return {!Rect}
   */
  rebaseTo(origin) {
    return new Rect(this.left + origin.left, this.top + origin.top, this.width, this.height);
  }
}

/**
 * @unrestricted
 */
class Constraints {
  /**
   * @param {!Size=} minimum
   * @param {?Size=} preferred
   */
  constructor(minimum, preferred) {
    /**
     * @type {!Size}
     */
    this.minimum = minimum || new Size(0, 0);

    /**
     * @type {!Size}
     */
    this.preferred = preferred || this.minimum;

    if (this.minimum.width > this.preferred.width || this.minimum.height > this.preferred.height) {
      throw new Error('Minimum size is greater than preferred.');
    }
  }

  /**
   * @param {?Constraints} constraints
   * @return {boolean}
   */
  isEqual(constraints) {
    return !!constraints && this.minimum.isEqual(constraints.minimum) && this.preferred.isEqual(constraints.preferred);
  }

  /**
   * @param {!Constraints|number} value
   * @return {!Constraints}
   */
  widthToMax(value) {
    if (typeof value === 'number') {
      return new Constraints(this.minimum.widthToMax(value), this.preferred.widthToMax(value));
    }
    return new Constraints(this.minimum.widthToMax(value.minimum), this.preferred.widthToMax(value.preferred));
  }

  /**
   * @param {!Constraints|number} value
   * @return {!Constraints}
   */
  addWidth(value) {
    if (typeof value === 'number') {
      return new Constraints(this.minimum.addWidth(value), this.preferred.addWidth(value));
    }
    return new Constraints(this.minimum.addWidth(value.minimum), this.preferred.addWidth(value.preferred));
  }

  /**
   * @param {!Constraints|number} value
   * @return {!Constraints}
   */
  heightToMax(value) {
    if (typeof value === 'number') {
      return new Constraints(this.minimum.heightToMax(value), this.preferred.heightToMax(value));
    }
    return new Constraints(this.minimum.heightToMax(value.minimum), this.preferred.heightToMax(value.preferred));
  }

  /**
   * @param {!Constraints|number} value
   * @return {!Constraints}
   */
  addHeight(value) {
    if (typeof value === 'number') {
      return new Constraints(this.minimum.addHeight(value), this.preferred.addHeight(value));
    }
    return new Constraints(this.minimum.addHeight(value.minimum), this.preferred.addHeight(value.preferred));
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

UI.Geometry = Geometry;

/**
 * @type {number}
 */
UI.Geometry._Eps = _Eps;

/**
 * @constructor
 */
UI.Geometry.Vector = Vector;

/**
 * @constructor
 */
UI.Geometry.Point = Point;

/**
 * @constructor
 */
UI.Geometry.CubicBezier = CubicBezier;

/**
 * @constructor
 */
UI.Geometry.EulerAngles = EulerAngles;

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {number}
 */
UI.Geometry.scalarProduct = scalarProduct;

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {!Vector}
 */
UI.Geometry.crossProduct = crossProduct;

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {!Vector}
 */
UI.Geometry.subtract = subtract;

/**
 * @param {!Vector} v
 * @param {!CSSMatrix} m
 * @return {!Vector}
 */
UI.Geometry.multiplyVectorByMatrixAndNormalize = multiplyVectorByMatrixAndNormalize;

/**
 * @param {!Vector} u
 * @param {!Vector} v
 * @return {number}
 */
UI.Geometry.calculateAngle = calculateAngle;

/**
 * @param {number} deg
 * @return {number}
 */
UI.Geometry.degreesToRadians = degreesToRadians;

/**
 * @param {number} rad
 * @return {number}
 */
UI.Geometry.radiansToDegrees = radiansToDegrees;

/** @constructor */
UI.Size = Size;

/** @constructor */
UI.Insets = Insets;

/** @constructor */
UI.Rect = Rect;

/** @constructor */
UI.Constraints = Constraints;

/**
 * @param {!CSSMatrix} matrix
 * @param {!Array.<number>} points
 * @param {{minX: number, maxX: number, minY: number, maxY: number}=} aggregateBounds
 * @return {!{minX: number, maxX: number, minY: number, maxY: number}}
 */
UI.Geometry.boundsForTransformedPoints = boundsForTransformedPoints;

var Geometry$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Geometry,
  _Eps: _Eps,
  Vector: Vector,
  Point: Point,
  CubicBezier: CubicBezier,
  EulerAngles: EulerAngles,
  scalarProduct: scalarProduct,
  crossProduct: crossProduct,
  subtract: subtract,
  multiplyVectorByMatrixAndNormalize: multiplyVectorByMatrixAndNormalize,
  calculateAngle: calculateAngle,
  degreesToRadians: degreesToRadians,
  radiansToDegrees: radiansToDegrees,
  boundsForTransformedPoints: boundsForTransformedPoints,
  Size: Size,
  Insets: Insets,
  Rect: Rect,
  Constraints: Constraints
});

// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class HistoryInput extends HTMLInputElement {
  constructor() {
    super();
    this._history = [''];
    this._historyPosition = 0;
    this.addEventListener('keydown', this._onKeyDown.bind(this), false);
    this.addEventListener('input', this._onInput.bind(this), false);
  }
  /**
   * @return {!HistoryInput}
   */
  static create() {
    if (!HistoryInput._constructor) {
      HistoryInput._constructor = UI.registerCustomElement('input', 'history-input', HistoryInput);
    }

    return /** @type {!HistoryInput} */ (HistoryInput._constructor());
  }

  /**
   * @param {!Event} event
   */
  _onInput(event) {
    if (this._history.length === this._historyPosition + 1) {
      this._history[this._history.length - 1] = this.value;
    }
  }

  /**
   * @param {!Event} event
   */
  _onKeyDown(event) {
    if (event.keyCode === UI.KeyboardShortcut.Keys.Up.code) {
      this._historyPosition = Math.max(this._historyPosition - 1, 0);
      this.value = this._history[this._historyPosition];
      this.dispatchEvent(new Event('input', {'bubbles': true, 'cancelable': true}));
      event.consume(true);
    } else if (event.keyCode === UI.KeyboardShortcut.Keys.Down.code) {
      this._historyPosition = Math.min(this._historyPosition + 1, this._history.length - 1);
      this.value = this._history[this._historyPosition];
      this.dispatchEvent(new Event('input', {'bubbles': true, 'cancelable': true}));
      event.consume(true);
    } else if (event.keyCode === UI.KeyboardShortcut.Keys.Enter.code) {
      this._saveToHistory();
    }
  }

  _saveToHistory() {
    if (this._history.length > 1 && this._history[this._history.length - 2] === this.value) {
      return;
    }
    this._history[this._history.length - 1] = this.value;
    this._historyPosition = this._history.length - 1;
    this._history.push('');
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.HistoryInput = HistoryInput;

var HistoryInput$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': HistoryInput
});

// Copyright 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class Icon extends HTMLSpanElement {
  constructor() {
    super();
    /** @type {?Icon.Descriptor} */
    this._descriptor = null;
    /** @type {?Icon.SpriteSheet} */
    this._spriteSheet = null;
    /** @type {string} */
    this._iconType = '';
  }

  /**
   * @param {string=} iconType
   * @param {string=} className
   * @return {!Icon}
   */
  static create(iconType, className) {
    if (!Icon._constructor) {
      Icon._constructor = UI.registerCustomElement('span', 'ui-icon', Icon);
    }

    const icon = /** @type {!Icon} */ (Icon._constructor());
    if (className) {
      icon.className = className;
    }
    if (iconType) {
      icon.setIconType(iconType);
    }
    return icon;
  }

  /**
   * @param {string} iconType
   */
  setIconType(iconType) {
    if (this._descriptor) {
      this.style.removeProperty('--spritesheet-position');
      this.style.removeProperty('width');
      this.style.removeProperty('height');
      this._toggleClasses(false);
      this._iconType = '';
      this._descriptor = null;
      this._spriteSheet = null;
    }
    const descriptor = Icon.Descriptors[iconType] || null;
    if (descriptor) {
      this._iconType = iconType;
      this._descriptor = descriptor;
      this._spriteSheet = Icon.SpriteSheets[this._descriptor.spritesheet];
      console.assert(
          this._spriteSheet, `ERROR: icon ${this._iconType} has unknown spritesheet: ${this._descriptor.spritesheet}`);

      this.style.setProperty('--spritesheet-position', this._propertyValue());
      this.style.setProperty('width', this._spriteSheet.cellWidth + 'px');
      this.style.setProperty('height', this._spriteSheet.cellHeight + 'px');
      this._toggleClasses(true);
    } else if (iconType) {
      throw new Error(`ERROR: failed to find icon descriptor for type: ${iconType}`);
    }
  }

  /**
   * @param {boolean} value
   */
  _toggleClasses(value) {
    this.classList.toggle('spritesheet-' + this._descriptor.spritesheet, value);
    this.classList.toggle(this._iconType, value);
    this.classList.toggle('icon-mask', value && !!this._descriptor.isMask);
    this.classList.toggle('icon-invert', value && !!this._descriptor.invert);
  }

  /**
   * @return {string}
   */
  _propertyValue() {
    if (!this._descriptor.coordinates) {
      if (!this._descriptor.position || !Icon._positionRegex.test(this._descriptor.position)) {
        throw new Error(`ERROR: icon '${this._iconType}' has malformed position: '${this._descriptor.position}'`);
      }
      const column = this._descriptor.position[0].toLowerCase().charCodeAt(0) - 97;
      const row = parseInt(this._descriptor.position.substring(1), 10) - 1;
      this._descriptor.coordinates = {
        x: -(this._spriteSheet.cellWidth + this._spriteSheet.padding) * column,
        y: (this._spriteSheet.cellHeight + this._spriteSheet.padding) * (row + 1) - this._spriteSheet.padding
      };
    }
    return `${this._descriptor.coordinates.x}px ${this._descriptor.coordinates.y}px`;
  }
}

const _positionRegex = /^[a-z][1-9][0-9]*$/;

/** @enum {!Icon.SpriteSheet} */
const SpriteSheets = {
  'smallicons': {cellWidth: 10, cellHeight: 10, padding: 10},
  'mediumicons': {cellWidth: 16, cellHeight: 16, padding: 0},
  'largeicons': {cellWidth: 28, cellHeight: 24, padding: 0},
  'arrowicons': {cellWidth: 19, cellHeight: 19, padding: 0}
};

/** @enum {!Icon.Descriptor} */
const Descriptors = {
  'smallicon-bezier': {position: 'a5', spritesheet: 'smallicons', isMask: true},
  'smallicon-checkmark': {position: 'b5', spritesheet: 'smallicons'},
  'smallicon-checkmark-square': {position: 'b6', spritesheet: 'smallicons', isMask: true},
  'smallicon-checkmark-behind': {position: 'd6', spritesheet: 'smallicons', isMask: true},
  'smallicon-command-result': {position: 'a4', spritesheet: 'smallicons'},
  'smallicon-contrast-ratio': {position: 'a6', spritesheet: 'smallicons', isMask: true},
  'smallicon-cross': {position: 'b4', spritesheet: 'smallicons'},
  'smallicon-device': {position: 'c5', spritesheet: 'smallicons'},
  'smallicon-error': {position: 'c4', spritesheet: 'smallicons'},
  'smallicon-expand-less': {position: 'f5', spritesheet: 'smallicons', isMask: true},
  'smallicon-expand-more': {position: 'e6', spritesheet: 'smallicons', isMask: true},
  'smallicon-green-arrow': {position: 'a3', spritesheet: 'smallicons'},
  'smallicon-green-ball': {position: 'b3', spritesheet: 'smallicons'},
  'smallicon-info': {position: 'c3', spritesheet: 'smallicons'},
  'smallicon-inline-breakpoint-conditional': {position: 'd4', spritesheet: 'smallicons'},
  'smallicon-inline-breakpoint': {position: 'd5', spritesheet: 'smallicons'},
  'smallicon-no': {position: 'c6', spritesheet: 'smallicons', isMask: true},
  'smallicon-orange-ball': {position: 'd3', spritesheet: 'smallicons'},
  'smallicon-red-ball': {position: 'a2', spritesheet: 'smallicons'},
  'smallicon-shadow': {position: 'b2', spritesheet: 'smallicons', isMask: true},
  'smallicon-step-in': {position: 'c2', spritesheet: 'smallicons'},
  'smallicon-step-out': {position: 'd2', spritesheet: 'smallicons'},
  'smallicon-text-prompt': {position: 'e5', spritesheet: 'smallicons'},
  'smallicon-thick-left-arrow': {position: 'e4', spritesheet: 'smallicons'},
  'smallicon-thick-right-arrow': {position: 'e3', spritesheet: 'smallicons'},
  'smallicon-triangle-down': {position: 'e2', spritesheet: 'smallicons', isMask: true},
  'smallicon-triangle-right': {position: 'a1', spritesheet: 'smallicons', isMask: true},
  'smallicon-triangle-up': {position: 'b1', spritesheet: 'smallicons', isMask: true},
  'smallicon-user-command': {position: 'c1', spritesheet: 'smallicons'},
  'smallicon-warning': {position: 'd1', spritesheet: 'smallicons'},
  'smallicon-network-product': {position: 'e1', spritesheet: 'smallicons'},
  'smallicon-clear-warning': {position: 'f1', spritesheet: 'smallicons', isMask: true},
  'smallicon-clear-info': {position: 'f2', spritesheet: 'smallicons'},
  'smallicon-clear-error': {position: 'f3', spritesheet: 'smallicons'},
  'smallicon-account-circle': {position: 'f4', spritesheet: 'smallicons'},
  'smallicon-videoplayer-paused': {position: 'f6', spritesheet: 'smallicons', isMask: true},
  'smallicon-videoplayer-playing': {position: 'g6', spritesheet: 'smallicons', isMask: true},
  'smallicon-videoplayer-destroyed': {position: 'g5', spritesheet: 'smallicons', isMask: true},

  'mediumicon-clear-storage': {position: 'a4', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-cookie': {position: 'b4', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-database': {position: 'c4', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-info': {position: 'c1', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-manifest': {position: 'd4', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-service-worker': {position: 'a3', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-table': {position: 'b3', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-arrow-in-circle': {position: 'c3', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-file-sync': {position: 'd3', spritesheet: 'mediumicons', invert: true},
  'mediumicon-file': {position: 'a2', spritesheet: 'mediumicons', invert: true},
  'mediumicon-gray-cross-active': {position: 'b2', spritesheet: 'mediumicons'},
  'mediumicon-gray-cross-hover': {position: 'c2', spritesheet: 'mediumicons'},
  'mediumicon-red-cross-active': {position: 'd2', spritesheet: 'mediumicons'},
  'mediumicon-red-cross-hover': {position: 'a1', spritesheet: 'mediumicons'},
  'mediumicon-search': {position: 'b1', spritesheet: 'mediumicons'},
  'mediumicon-replace': {position: 'c5', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-account-circle': {position: 'e4', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-warning-triangle': {position: 'e1', spritesheet: 'mediumicons'},
  'mediumicon-error-circle': {position: 'e3', spritesheet: 'mediumicons'},
  'mediumicon-info-circle': {position: 'e2', spritesheet: 'mediumicons'},
  'mediumicon-bug': {position: 'd1', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-list': {position: 'e5', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-warning': {position: 'd5', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-sync': {position: 'a5', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-fetch': {position: 'b5', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-cloud': {position: 'a6', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-bell': {position: 'b6', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-payment': {position: 'c6', spritesheet: 'mediumicons', isMask: true},
  'mediumicon-schedule': {position: 'd6', spritesheet: 'mediumicons', isMask: true},

  'badge-navigator-file-sync': {position: 'a9', spritesheet: 'largeicons'},
  'largeicon-activate-breakpoints': {position: 'b9', spritesheet: 'largeicons', isMask: true},
  'largeicon-add': {position: 'a8', spritesheet: 'largeicons', isMask: true},
  'largeicon-background-color': {position: 'b8', spritesheet: 'largeicons', isMask: true},
  'largeicon-box-shadow': {position: 'a7', spritesheet: 'largeicons', isMask: true},
  'largeicon-camera': {position: 'b7', spritesheet: 'largeicons', isMask: true},
  'largeicon-center': {position: 'c9', spritesheet: 'largeicons', isMask: true},
  'largeicon-checkmark': {position: 'c8', spritesheet: 'largeicons', isMask: true},
  'largeicon-chevron': {position: 'c7', spritesheet: 'largeicons', isMask: true},
  'largeicon-clear': {position: 'a6', spritesheet: 'largeicons', isMask: true},
  'largeicon-copy': {position: 'b6', spritesheet: 'largeicons', isMask: true},
  'largeicon-deactivate-breakpoints': {position: 'c6', spritesheet: 'largeicons', isMask: true},
  'largeicon-delete': {position: 'd9', spritesheet: 'largeicons', isMask: true},
  'largeicon-dock-to-bottom': {position: 'd8', spritesheet: 'largeicons', isMask: true},
  'largeicon-dock-to-left': {position: 'd7', spritesheet: 'largeicons', isMask: true},
  'largeicon-dock-to-right': {position: 'd6', spritesheet: 'largeicons', isMask: true},
  'largeicon-download': {position: 'h6', spritesheet: 'largeicons', isMask: true},
  'largeicon-edit': {position: 'a5', spritesheet: 'largeicons', isMask: true},
  'largeicon-eyedropper': {position: 'b5', spritesheet: 'largeicons', isMask: true},
  'largeicon-filter': {position: 'c5', spritesheet: 'largeicons', isMask: true},
  'largeicon-foreground-color': {position: 'd5', spritesheet: 'largeicons', isMask: true},
  'largeicon-hide-bottom-sidebar': {position: 'e9', spritesheet: 'largeicons', isMask: true},
  'largeicon-hide-left-sidebar': {position: 'e8', spritesheet: 'largeicons', isMask: true},
  'largeicon-hide-right-sidebar': {position: 'e7', spritesheet: 'largeicons', isMask: true},
  'largeicon-hide-top-sidebar': {position: 'e6', spritesheet: 'largeicons', isMask: true},
  'largeicon-large-list': {position: 'e5', spritesheet: 'largeicons', isMask: true},
  'largeicon-layout-editor': {position: 'a4', spritesheet: 'largeicons', isMask: true},
  'largeicon-load': {position: 'h5', spritesheet: 'largeicons', isMask: true},
  'largeicon-longclick-triangle': {position: 'b4', spritesheet: 'largeicons', isMask: true},
  'largeicon-menu': {position: 'c4', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-domain': {position: 'd4', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-file': {position: 'e4', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-file-sync': {position: 'f9', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-folder': {position: 'f8', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-frame': {position: 'f7', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-snippet': {position: 'f6', spritesheet: 'largeicons', isMask: true},
  'largeicon-navigator-worker': {position: 'f5', spritesheet: 'largeicons', isMask: true},
  'largeicon-node-search': {position: 'f4', spritesheet: 'largeicons', isMask: true},
  'largeicon-pan': {position: 'a3', spritesheet: 'largeicons', isMask: true},
  'largeicon-pause-animation': {position: 'b3', spritesheet: 'largeicons', isMask: true},
  'largeicon-pause': {position: 'c3', spritesheet: 'largeicons', isMask: true},
  'largeicon-pause-on-exceptions': {position: 'd3', spritesheet: 'largeicons', isMask: true},
  'largeicon-phone': {position: 'e3', spritesheet: 'largeicons', isMask: true},
  'largeicon-play-animation': {position: 'f3', spritesheet: 'largeicons', isMask: true},
  'largeicon-play-back': {position: 'a2', spritesheet: 'largeicons', isMask: true},
  'largeicon-play': {position: 'b2', spritesheet: 'largeicons', isMask: true},
  'largeicon-pretty-print': {position: 'c2', spritesheet: 'largeicons', isMask: true},
  'largeicon-refresh': {position: 'd2', spritesheet: 'largeicons', isMask: true},
  'largeicon-replay-animation': {position: 'e2', spritesheet: 'largeicons', isMask: true},
  'largeicon-resume': {position: 'f2', spritesheet: 'largeicons', isMask: true},
  'largeicon-rotate': {position: 'g9', spritesheet: 'largeicons', isMask: true},
  'largeicon-rotate-screen': {position: 'g8', spritesheet: 'largeicons', isMask: true},
  'largeicon-search': {position: 'h4', spritesheet: 'largeicons', isMask: true},
  'largeicon-settings-gear': {position: 'g7', spritesheet: 'largeicons', isMask: true},
  'largeicon-show-bottom-sidebar': {position: 'g6', spritesheet: 'largeicons', isMask: true},
  'largeicon-show-left-sidebar': {position: 'g5', spritesheet: 'largeicons', isMask: true},
  'largeicon-show-right-sidebar': {position: 'g4', spritesheet: 'largeicons', isMask: true},
  'largeicon-show-top-sidebar': {position: 'g3', spritesheet: 'largeicons', isMask: true},
  'largeicon-start-recording': {position: 'g2', spritesheet: 'largeicons', isMask: true},
  'largeicon-step-into': {position: 'a1', spritesheet: 'largeicons', isMask: true},
  'largeicon-step-out': {position: 'b1', spritesheet: 'largeicons', isMask: true},
  'largeicon-step-over': {position: 'c1', spritesheet: 'largeicons', isMask: true},
  'largeicon-step': {position: 'h1', spritesheet: 'largeicons', isMask: true},
  'largeicon-stop-recording': {position: 'd1', spritesheet: 'largeicons', isMask: true},
  'largeicon-terminate-execution': {position: 'h2', spritesheet: 'largeicons', isMask: true},
  'largeicon-text-shadow': {position: 'e1', spritesheet: 'largeicons', isMask: true},
  'largeicon-trash-bin': {position: 'f1', spritesheet: 'largeicons', isMask: true},
  'largeicon-undo': {position: 'h7', spritesheet: 'largeicons', isMask: true},
  'largeicon-undock': {position: 'g1', spritesheet: 'largeicons', isMask: true},
  'largeicon-visibility': {position: 'h9', spritesheet: 'largeicons', isMask: true},
  'largeicon-waterfall': {position: 'h8', spritesheet: 'largeicons', isMask: true},

  'mediumicon-arrow-top': {position: 'a4', spritesheet: 'arrowicons'},
  'mediumicon-arrow-bottom': {position: 'a3', spritesheet: 'arrowicons'},
  'mediumicon-arrow-left': {position: 'a2', spritesheet: 'arrowicons'},
  'mediumicon-arrow-right': {position: 'a1', spritesheet: 'arrowicons'}
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Icon = Icon;

UI.Icon._positionRegex = _positionRegex;

/** @enum {!Icon.SpriteSheet} */
UI.Icon.SpriteSheets = SpriteSheets;

/** @enum {!Icon.Descriptor} */
UI.Icon.Descriptors = Descriptors;

/** @typedef {{position: string, spritesheet: string, isMask: (boolean|undefined), coordinates: ({x: number, y: number}|undefined), invert: (boolean|undefined)}} */
UI.Icon.Descriptor;

/** @typedef {{cellWidth: number, cellHeight: number, padding: number}} */
UI.Icon.SpriteSheet;

var Icon$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Icon,
  _positionRegex: _positionRegex,
  SpriteSheets: SpriteSheets,
  Descriptors: Descriptors
});

// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class Infobar {
  /**
   * @param {!Type} type
   * @param {string} text
   * @param {!Common.Setting=} disableSetting
   */
  constructor(type, text, disableSetting) {
    this.element = createElementWithClass('div', 'flex-none');
    this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, 'ui/infobar.css');
    this._contentElement = this._shadowRoot.createChild('div', 'infobar infobar-' + type);

    this._mainRow = this._contentElement.createChild('div', 'infobar-main-row');
    this._mainRow.createChild('div', type + '-icon icon');
    this._mainRowText = this._mainRow.createChild('div', 'infobar-main-title');
    this._mainRowText.textContent = text;
    this._detailsRows = this._contentElement.createChild('div', 'infobar-details-rows hidden');

    this._toggleElement =
        UI.createTextButton(ls`more`, this._onToggleDetails.bind(this), 'infobar-toggle link-style hidden');
    this._mainRow.appendChild(this._toggleElement);

    /** @type {?Common.Setting} */
    this._disableSetting = disableSetting || null;
    if (disableSetting) {
      const disableButton =
          UI.createTextButton(ls`never show`, this._onDisable.bind(this), 'infobar-toggle link-style');
      this._mainRow.appendChild(disableButton);
    }

    this._closeButton = this._contentElement.createChild('div', 'close-button', 'dt-close-button');
    this._closeButton.setTabbable(true);
    self.onInvokeElement(this._closeButton, this.dispose.bind(this));

    /** @type {?function()} */
    this._closeCallback = null;
  }

  /**
   * @param {!Type} type
   * @param {string} text
   * @param {!Common.Setting=} disableSetting
   * @return {?Infobar}
   */
  static create(type, text, disableSetting) {
    if (disableSetting && disableSetting.get()) {
      return null;
    }
    return new Infobar(type, text, disableSetting);
  }

  dispose() {
    this.element.remove();
    this._onResize();
    if (this._closeCallback) {
      this._closeCallback.call(null);
    }
  }

  /**
   * @param {string} text
   */
  setText(text) {
    this._mainRowText.textContent = text;
    this._onResize();
  }

  /**
   * @param {?function()} callback
   */
  setCloseCallback(callback) {
    this._closeCallback = callback;
  }

  /**
   * @param {!UI.Widget} parentView
   */
  setParentView(parentView) {
    this._parentView = parentView;
  }

  _onResize() {
    if (this._parentView) {
      this._parentView.doResize();
    }
  }

  _onDisable() {
    this._disableSetting.set(true);
    this.dispose();
  }

  _onToggleDetails() {
    this._detailsRows.classList.remove('hidden');
    this._toggleElement.remove();
    this._onResize();
  }

  /**
   * @param {string=} message
   * @return {!Element}
   */
  createDetailsRowMessage(message) {
    this._toggleElement.classList.remove('hidden');
    const infobarDetailsRow = this._detailsRows.createChild('div', 'infobar-details-row');
    const detailsRowMessage = infobarDetailsRow.createChild('span', 'infobar-row-message');
    detailsRowMessage.textContent = message || '';
    return detailsRowMessage;
  }
}

/** @enum {string} */
const Type = {
  Warning: 'warning',
  Info: 'info'
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Infobar = Infobar;

/** @enum {string} */
UI.Infobar.Type = Type;

var Infobar$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Infobar,
  Type: Type
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class InplaceEditor {
  /**
   * @param {!Element} element
   * @param {!InplaceEditor.Config=} config
   * @return {?InplaceEditor.Controller}
   */
  static startEditing(element, config) {
    if (!InplaceEditor._defaultInstance) {
      InplaceEditor._defaultInstance = new InplaceEditor();
    }
    return InplaceEditor._defaultInstance.startEditing(element, config);
  }

  /**
   * @return {string}
   */
  editorContent(editingContext) {
    const element = editingContext.element;
    if (element.tagName === 'INPUT' && element.type === 'text') {
      return element.value;
    }

    return element.textContent;
  }

  setUpEditor(editingContext) {
    const element = editingContext.element;
    element.classList.add('editing');
    element.setAttribute('contenteditable', 'plaintext-only');

    const oldRole = element.getAttribute('role');
    UI.ARIAUtils.markAsTextBox(element);
    editingContext.oldRole = oldRole;

    const oldTabIndex = element.getAttribute('tabIndex');
    if (typeof oldTabIndex !== 'number' || oldTabIndex < 0) {
      element.tabIndex = 0;
    }
    this._focusRestorer = new UI.ElementFocusRestorer(element);
    editingContext.oldTabIndex = oldTabIndex;
  }

  closeEditor(editingContext) {
    const element = editingContext.element;
    element.classList.remove('editing');
    element.removeAttribute('contenteditable');

    if (typeof editingContext.oldRole !== 'string') {
      element.removeAttribute('role');
    } else {
      element.role = editingContext.oldRole;
    }

    if (typeof editingContext.oldTabIndex !== 'number') {
      element.removeAttribute('tabIndex');
    } else {
      element.tabIndex = editingContext.oldTabIndex;
    }
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }

  cancelEditing(editingContext) {
    const element = editingContext.element;
    if (element.tagName === 'INPUT' && element.type === 'text') {
      element.value = editingContext.oldText;
    } else {
      element.textContent = editingContext.oldText;
    }
  }

  augmentEditingHandle(editingContext, handle) {
  }

  /**
   * @param {!Element} element
   * @param {!InplaceEditor.Config=} config
   * @return {?InplaceEditor.Controller}
   */
  startEditing(element, config) {
    if (!UI.markBeingEdited(element, true)) {
      return null;
    }

    config = config || new InplaceEditor.Config(function() {}, function() {});
    const editingContext = {element: element, config: config};
    const committedCallback = config.commitHandler;
    const cancelledCallback = config.cancelHandler;
    const pasteCallback = config.pasteHandler;
    const context = config.context;
    let moveDirection = '';
    const self = this;

    this.setUpEditor(editingContext);

    editingContext.oldText = this.editorContent(editingContext);

    /**
     * @param {!Event=} e
     */
    function blurEventListener(e) {
      if (config.blurHandler && !config.blurHandler(element, e)) {
        return;
      }
      editingCommitted.call(element);
    }

    function cleanUpAfterEditing() {
      UI.markBeingEdited(element, false);

      element.removeEventListener('blur', blurEventListener, false);
      element.removeEventListener('keydown', keyDownEventListener, true);
      if (pasteCallback) {
        element.removeEventListener('paste', pasteEventListener, true);
      }

      if (self._focusRestorer) {
        self._focusRestorer.restore();
      }
      self.closeEditor(editingContext);
    }

    /** @this {Element} */
    function editingCancelled() {
      self.cancelEditing(editingContext);
      cleanUpAfterEditing();
      cancelledCallback(this, context);
    }

    /** @this {Element} */
    function editingCommitted() {
      cleanUpAfterEditing();

      committedCallback(this, self.editorContent(editingContext), editingContext.oldText, context, moveDirection);
    }

    /**
     * @param {!Event} event
     * @return {string}
     */
    function defaultFinishHandler(event) {
      if (isEnterKey(event)) {
        return 'commit';
      } else if (event.keyCode === UI.KeyboardShortcut.Keys.Esc.code || event.key === 'Escape') {
        return 'cancel';
      } else if (event.key === 'Tab') {
        return 'move-' + (event.shiftKey ? 'backward' : 'forward');
      }
      return '';
    }

    function handleEditingResult(result, event) {
      if (result === 'commit') {
        editingCommitted.call(element);
        event.consume(true);
      } else if (result === 'cancel') {
        editingCancelled.call(element);
        event.consume(true);
      } else if (result && result.startsWith('move-')) {
        moveDirection = result.substring(5);
        if (event.key === 'Tab') {
          event.consume(true);
        }
        blurEventListener();
      }
    }

    /**
     * @param {!Event} event
     */
    function pasteEventListener(event) {
      const result = pasteCallback(event);
      handleEditingResult(result, event);
    }

    /**
     * @param {!Event} event
     */
    function keyDownEventListener(event) {
      let result = defaultFinishHandler(event);
      if (!result && config.postKeydownFinishHandler) {
        result = config.postKeydownFinishHandler(event);
      }
      handleEditingResult(result, event);
    }

    element.addEventListener('blur', blurEventListener, false);
    element.addEventListener('keydown', keyDownEventListener, true);
    if (pasteCallback) {
      element.addEventListener('paste', pasteEventListener, true);
    }

    const handle = {cancel: editingCancelled.bind(element), commit: editingCommitted.bind(element)};
    this.augmentEditingHandle(editingContext, handle);
    return handle;
  }
}


/**
 * @template T
 * @unrestricted
 */
class Config {
  /**
   * @param {function(!Element,string,string,T,string)} commitHandler
   * @param {function(!Element,T)} cancelHandler
   * @param {T=} context
   * @param {function(!Element,!Event):boolean=} blurHandler
   */
  constructor(commitHandler, cancelHandler, context, blurHandler) {
    this.commitHandler = commitHandler;
    this.cancelHandler = cancelHandler;
    this.context = context;
    this.blurHandler = blurHandler;

    /**
     * @type {function(!Event):string|undefined}
     */
    this.pasteHandler;

    /**
     * @type {function(!Event):string|undefined}
     */
    this.postKeydownFinishHandler;
  }

  setPasteHandler(pasteHandler) {
    this.pasteHandler = pasteHandler;
  }

  /**
   * @param {function(!Event):string} postKeydownFinishHandler
   */
  setPostKeydownFinishHandler(postKeydownFinishHandler) {
    this.postKeydownFinishHandler = postKeydownFinishHandler;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.InplaceEditor = InplaceEditor;

/**
 * @constructor
 */
UI.InplaceEditor.Config = Config;

/**
 * @typedef {{cancel: function(), commit: function()}}
 */
UI.InplaceEditor.Controller;

var InplaceEditor$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': InplaceEditor,
  Config: Config
});

/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * @implements {UI.ViewLocationResolver}
 * @unrestricted
 */
class InspectorView extends UI.VBox {
  constructor() {
    super();
    UI.GlassPane.setContainer(this.element);
    this.setMinimumSize(240, 72);

    // DevTools sidebar is a vertical split of panels tabbed pane and a drawer.
    this._drawerSplitWidget = new UI.SplitWidget(false, true, 'Inspector.drawerSplitViewState', 200, 200);
    this._drawerSplitWidget.hideSidebar();
    this._drawerSplitWidget.hideDefaultResizer();
    this._drawerSplitWidget.enableShowModeSaving();
    this._drawerSplitWidget.show(this.element);

    // Create drawer tabbed pane.
    this._drawerTabbedLocation =
        UI.viewManager.createTabbedLocation(this._showDrawer.bind(this, false), 'drawer-view', true, true);
    const moreTabsButton = this._drawerTabbedLocation.enableMoreTabsButton();
    moreTabsButton.setTitle(ls`More Tools`);
    this._drawerTabbedPane = this._drawerTabbedLocation.tabbedPane();
    this._drawerTabbedPane.setMinimumSize(0, 27);
    const closeDrawerButton = new UI.ToolbarButton(Common.UIString('Close drawer'), 'largeicon-delete');
    closeDrawerButton.addEventListener(UI.ToolbarButton.Events.Click, this._closeDrawer, this);
    this._drawerSplitWidget.installResizer(this._drawerTabbedPane.headerElement());
    this._drawerTabbedPane.addEventListener(UI.TabbedPane.Events.TabSelected, this._drawerTabSelected, this);

    this._drawerSplitWidget.setSidebarWidget(this._drawerTabbedPane);
    this._drawerTabbedPane.rightToolbar().appendToolbarItem(closeDrawerButton);

    // Create main area tabbed pane.
    this._tabbedLocation = UI.viewManager.createTabbedLocation(
        Host.InspectorFrontendHost.bringToFront.bind(Host.InspectorFrontendHost), 'panel', true, true,
        Root.Runtime.queryParam('panel'));

    this._tabbedPane = this._tabbedLocation.tabbedPane();
    this._tabbedPane.registerRequiredCSS('ui/inspectorViewTabbedPane.css');
    this._tabbedPane.addEventListener(UI.TabbedPane.Events.TabSelected, this._tabSelected, this);
    this._tabbedPane.setAccessibleName(Common.UIString('Panels'));

    // Store the initial selected panel for use in launch histograms
    Host.userMetrics.setLaunchPanel(this._tabbedPane.selectedTabId);

    if (Host.isUnderTest()) {
      this._tabbedPane.setAutoSelectFirstItemOnShow(false);
    }
    this._drawerSplitWidget.setMainWidget(this._tabbedPane);

    this._keyDownBound = this._keyDown.bind(this);
    Host.InspectorFrontendHost.events.addEventListener(
        Host.InspectorFrontendHostAPI.Events.ShowPanel, showPanel.bind(this));

    /**
     * @this {InspectorView}
     * @param {!Common.Event} event
     */
    function showPanel(event) {
      const panelName = /** @type {string} */ (event.data);
      this.showPanel(panelName);
    }
  }

  /**
   * @return {!InspectorView}
   */
  static instance() {
    return /** @type {!InspectorView} */ (self.runtime.sharedInstance(InspectorView));
  }

  /**
   * @override
   */
  wasShown() {
    this.element.ownerDocument.addEventListener('keydown', this._keyDownBound, false);
  }

  /**
   * @override
   */
  willHide() {
    this.element.ownerDocument.removeEventListener('keydown', this._keyDownBound, false);
  }

  /**
   * @override
   * @param {string} locationName
   * @return {?UI.ViewLocation}
   */
  resolveLocation(locationName) {
    if (locationName === 'drawer-view') {
      return this._drawerTabbedLocation;
    }
    if (locationName === 'panel') {
      return this._tabbedLocation;
    }
    return null;
  }

  createToolbars() {
    this._tabbedPane.leftToolbar().appendItemsAtLocation('main-toolbar-left');
    this._tabbedPane.rightToolbar().appendItemsAtLocation('main-toolbar-right');
  }

  /**
   * @param {!UI.View} view
   */
  addPanel(view) {
    this._tabbedLocation.appendView(view);
  }

  /**
   * @param {string} panelName
   * @return {boolean}
   */
  hasPanel(panelName) {
    return this._tabbedPane.hasTab(panelName);
  }

  /**
   * @param {string} panelName
   * @return {!Promise.<!UI.Panel>}
   */
  panel(panelName) {
    return /** @type {!Promise.<!UI.Panel>} */ (UI.viewManager.view(panelName).widget());
  }

  /**
   * @param {boolean} allTargetsSuspended
   */
  onSuspendStateChanged(allTargetsSuspended) {
    this._currentPanelLocked = allTargetsSuspended;
    this._tabbedPane.setCurrentTabLocked(this._currentPanelLocked);
    this._tabbedPane.leftToolbar().setEnabled(!this._currentPanelLocked);
    this._tabbedPane.rightToolbar().setEnabled(!this._currentPanelLocked);
  }

  /**
   * @param {string} panelName
   * @return {boolean}
   */
  canSelectPanel(panelName) {
    return !this._currentPanelLocked || this._tabbedPane.selectedTabId === panelName;
  }

  /**
   * @param {string} panelName
   * @return {!Promise.<?UI.Panel>}
   */
  showPanel(panelName) {
    return UI.viewManager.showView(panelName);
  }

  /**
   * @param {string} panelName
   * @param {?UI.Icon} icon
   */
  setPanelIcon(panelName, icon) {
    this._tabbedPane.setTabIcon(panelName, icon);
  }

  /**
   * @return {!UI.Panel}
   */
  currentPanelDeprecated() {
    return /** @type {!UI.Panel} */ (UI.viewManager.materializedWidget(this._tabbedPane.selectedTabId || ''));
  }

  /**
   * @param {boolean} focus
   */
  _showDrawer(focus) {
    if (this._drawerTabbedPane.isShowing()) {
      return;
    }
    this._drawerSplitWidget.showBoth();
    if (focus) {
      this._focusRestorer = new UI.WidgetFocusRestorer(this._drawerTabbedPane);
    } else {
      this._focusRestorer = null;
    }
  }

  /**
   * @return {boolean}
   */
  drawerVisible() {
    return this._drawerTabbedPane.isShowing();
  }

  _closeDrawer() {
    if (!this._drawerTabbedPane.isShowing()) {
      return;
    }
    if (this._focusRestorer) {
      this._focusRestorer.restore();
    }
    this._drawerSplitWidget.hideSidebar(true);
  }

  /**
   * @param {boolean} minimized
   */
  setDrawerMinimized(minimized) {
    this._drawerSplitWidget.setSidebarMinimized(minimized);
    this._drawerSplitWidget.setResizable(!minimized);
  }

  /**
   * @return {boolean}
   */
  isDrawerMinimized() {
    return this._drawerSplitWidget.isSidebarMinimized();
  }

  /**
   * @param {string} id
   * @param {boolean=} userGesture
   */
  closeDrawerTab(id, userGesture) {
    this._drawerTabbedPane.closeTab(id, userGesture);
  }

  /**
   * @param {!Event} event
   */
  _keyDown(event) {
    const keyboardEvent = /** @type {!KeyboardEvent} */ (event);
    if (!UI.KeyboardShortcut.eventHasCtrlOrMeta(keyboardEvent) || event.altKey || event.shiftKey) {
      return;
    }

    // Ctrl/Cmd + 1-9 should show corresponding panel.
    const panelShortcutEnabled = Common.moduleSetting('shortcutPanelSwitch').get();
    if (panelShortcutEnabled) {
      let panelIndex = -1;
      if (event.keyCode > 0x30 && event.keyCode < 0x3A) {
        panelIndex = event.keyCode - 0x31;
      } else if (
          event.keyCode > 0x60 && event.keyCode < 0x6A &&
          keyboardEvent.location === KeyboardEvent.DOM_KEY_LOCATION_NUMPAD) {
        panelIndex = event.keyCode - 0x61;
      }
      if (panelIndex !== -1) {
        const panelName = this._tabbedPane.tabIds()[panelIndex];
        if (panelName) {
          if (!UI.Dialog.hasInstance() && !this._currentPanelLocked) {
            this.showPanel(panelName);
          }
          event.consume(true);
        }
      }
    }
  }

  /**
   * @override
   */
  onResize() {
    UI.GlassPane.containerMoved(this.element);
  }

  /**
   * @return {!Element}
   */
  topResizerElement() {
    return this._tabbedPane.headerElement();
  }

  toolbarItemResized() {
    this._tabbedPane.headerResized();
  }

  /**
   * @param {!Common.Event} event
   */
  _tabSelected(event) {
    const tabId = /** @type {string} */ (event.data['tabId']);
    Host.userMetrics.panelShown(tabId);
  }

  /**
   * @param {!Common.Event} event
   */
  _drawerTabSelected(event) {
    const tabId = /** @type {string} */ (event.data['tabId']);
    Host.userMetrics.drawerShown(tabId);
  }

  /**
   * @param {!UI.SplitWidget} splitWidget
   */
  setOwnerSplit(splitWidget) {
    this._ownerSplitWidget = splitWidget;
  }

  minimize() {
    if (this._ownerSplitWidget) {
      this._ownerSplitWidget.setSidebarMinimized(true);
    }
  }

  restore() {
    if (this._ownerSplitWidget) {
      this._ownerSplitWidget.setSidebarMinimized(false);
    }
  }
}

/**
 * @implements {UI.ActionDelegate}
 * @unrestricted
 */
class ActionDelegate {
  /**
   * @override
   * @param {!UI.Context} context
   * @param {string} actionId
   * @return {boolean}
   */
  handleAction(context, actionId) {
    switch (actionId) {
      case 'main.toggle-drawer':
        if (UI.inspectorView.drawerVisible()) {
          UI.inspectorView._closeDrawer();
        } else {
          UI.inspectorView._showDrawer(true);
        }
        return true;
      case 'main.next-tab':
        UI.inspectorView._tabbedPane.selectNextTab();
        UI.inspectorView._tabbedPane.focus();
        return true;
      case 'main.previous-tab':
        UI.inspectorView._tabbedPane.selectPrevTab();
        UI.inspectorView._tabbedPane.focus();
        return true;
    }
    return false;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.InspectorView = InspectorView;

/**
 * @implements {UI.ActionDelegate}
 * @unrestricted
 */
UI.InspectorView.ActionDelegate = ActionDelegate;

/**
 * @type {!InspectorView}
 */
UI.inspectorView;

var InspectorView$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': InspectorView,
  ActionDelegate: ActionDelegate
});

/*
 * Copyright (C) 2009 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class KeyboardShortcut {
  /**
   * Creates a number encoding keyCode in the lower 8 bits and modifiers mask in the higher 8 bits.
   * It is useful for matching pressed keys.
   *
   * @param {number|string} keyCode The code of the key, or a character "a-z" which is converted to a keyCode value.
   * @param {number=} modifiers Optional list of modifiers passed as additional parameters.
   * @return {number}
   */
  static makeKey(keyCode, modifiers) {
    if (typeof keyCode === 'string') {
      keyCode = keyCode.charCodeAt(0) - (/^[a-z]/.test(keyCode) ? 32 : 0);
    }
    modifiers = modifiers || Modifiers.None;
    return KeyboardShortcut._makeKeyFromCodeAndModifiers(keyCode, modifiers);
  }

  /**
   * @param {?KeyboardEvent} keyboardEvent
   * @return {number}
   */
  static makeKeyFromEvent(keyboardEvent) {
    let modifiers = Modifiers.None;
    if (keyboardEvent.shiftKey) {
      modifiers |= Modifiers.Shift;
    }
    if (keyboardEvent.ctrlKey) {
      modifiers |= Modifiers.Ctrl;
    }
    if (keyboardEvent.altKey) {
      modifiers |= Modifiers.Alt;
    }
    if (keyboardEvent.metaKey) {
      modifiers |= Modifiers.Meta;
    }

    // Use either a real or a synthetic keyCode (for events originating from extensions).
    const keyCode = keyboardEvent.keyCode || keyboardEvent['__keyCode'];
    return KeyboardShortcut._makeKeyFromCodeAndModifiers(keyCode, modifiers);
  }

  /**
   * @param {?KeyboardEvent} keyboardEvent
   * @return {number}
   */
  static makeKeyFromEventIgnoringModifiers(keyboardEvent) {
    const keyCode = keyboardEvent.keyCode || keyboardEvent['__keyCode'];
    return KeyboardShortcut._makeKeyFromCodeAndModifiers(keyCode, Modifiers.None);
  }

  /**
   * @param {(?KeyboardEvent|?MouseEvent)} event
   * @return {boolean}
   */
  static eventHasCtrlOrMeta(event) {
    return Host.isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  static hasNoModifiers(event) {
    return !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  }

  /**
   * @param {string|!UI.KeyboardShortcut.Key} key
   * @param {number=} modifiers
   * @return {!KeyboardShortcut.Descriptor}
   */
  static makeDescriptor(key, modifiers) {
    return {
      key: KeyboardShortcut.makeKey(typeof key === 'string' ? key : key.code, modifiers),
      name: KeyboardShortcut.shortcutToString(key, modifiers)
    };
  }

  /**
   * @param {string} shortcut
   * @return {?KeyboardShortcut.Descriptor}
   */
  static makeDescriptorFromBindingShortcut(shortcut) {
    const parts = shortcut.split(/\+(?!$)/);
    let modifiers = 0;
    let keyString;
    for (let i = 0; i < parts.length; ++i) {
      if (typeof Modifiers[parts[i]] !== 'undefined') {
        modifiers |= Modifiers[parts[i]];
        continue;
      }
      console.assert(
          i === parts.length - 1, 'Only one key other than modifier is allowed in shortcut <' + shortcut + '>');
      keyString = parts[i];
      break;
    }
    console.assert(keyString, 'Modifiers-only shortcuts are not allowed (encountered <' + shortcut + '>)');
    if (!keyString) {
      return null;
    }

    const key = KeyboardShortcut.Keys[keyString] || KeyboardShortcut.KeyBindings[keyString];
    if (key && key.shiftKey) {
      modifiers |= Modifiers.Shift;
    }
    return KeyboardShortcut.makeDescriptor(key ? key : keyString, modifiers);
  }

  /**
   * @param {string|!UI.KeyboardShortcut.Key} key
   * @param {number=} modifiers
   * @return {string}
   */
  static shortcutToString(key, modifiers) {
    return KeyboardShortcut._modifiersToString(modifiers) + KeyboardShortcut._keyName(key);
  }

  /**
   * @param {string|!UI.KeyboardShortcut.Key} key
   * @return {string}
   */
  static _keyName(key) {
    if (typeof key === 'string') {
      return key.toUpperCase();
    }
    if (typeof key.name === 'string') {
      return key.name;
    }
    return key.name[Host.platform()] || key.name.other || '';
  }

  /**
   * @param {number} keyCode
   * @param {?number} modifiers
   * @return {number}
   */
  static _makeKeyFromCodeAndModifiers(keyCode, modifiers) {
    return (keyCode & 255) | (modifiers << 8);
  }

  /**
   * @param {number} key
   * @return {!{keyCode: number, modifiers: number}}
   */
  static keyCodeAndModifiersFromKey(key) {
    return {keyCode: key & 255, modifiers: key >> 8};
  }

  /**
   * @param {number|undefined} modifiers
   * @return {string}
   */
  static _modifiersToString(modifiers) {
    const isMac = Host.isMac();
    const m = Modifiers;
    const modifierNames = new Map([
      [m.Ctrl, isMac ? 'Ctrl\u2004' : 'Ctrl\u200A+\u200A'], [m.Alt, isMac ? '\u2325\u2004' : 'Alt\u200A+\u200A'],
      [m.Shift, isMac ? '\u21e7\u2004' : 'Shift\u200A+\u200A'], [m.Meta, isMac ? '\u2318\u2004' : 'Win\u200A+\u200A']
    ]);
    return [m.Meta, m.Ctrl, m.Alt, m.Shift].map(mapModifiers).join('');

    /**
     * @param {number} m
     * @return {string}
     */
    function mapModifiers(m) {
      return modifiers & m ? /** @type {string} */ (modifierNames.get(m)) : '';
    }
  }
}

/**
 * Constants for encoding modifier key set as a bit mask.
 * @see #_makeKeyFromCodeAndModifiers
 */
const Modifiers = {
  None: 0,  // Constant for empty modifiers set.
  Shift: 1,
  Ctrl: 2,
  Alt: 4,
  Meta: 8,  // Command key on Mac, Win key on other platforms.
  get CtrlOrMeta() {
    // "default" command/ctrl key for platform, Command on Mac, Ctrl on other platforms
    return Host.isMac() ? this.Meta : this.Ctrl;
  },
  get ShiftOrOption() {
    // Option on Mac, Shift on other platforms
    return Host.isMac() ? this.Alt : this.Shift;
  }
};

/** @type {!Object.<string, !UI.KeyboardShortcut.Key>} */
const Keys = {
  Backspace: {code: 8, name: '\u21a4'},
  Tab: {code: 9, name: {mac: '\u21e5', other: 'Tab'}},
  Enter: {code: 13, name: {mac: '\u21a9', other: 'Enter'}},
  Shift: {code: 16, name: {mac: '\u21e7', other: 'Shift'}},
  Ctrl: {code: 17, name: 'Ctrl'},
  Esc: {code: 27, name: 'Esc'},
  Space: {code: 32, name: 'Space'},
  PageUp: {code: 33, name: {mac: '\u21de', other: 'PageUp'}},      // also NUM_NORTH_EAST
  PageDown: {code: 34, name: {mac: '\u21df', other: 'PageDown'}},  // also NUM_SOUTH_EAST
  End: {code: 35, name: {mac: '\u2197', other: 'End'}},            // also NUM_SOUTH_WEST
  Home: {code: 36, name: {mac: '\u2196', other: 'Home'}},          // also NUM_NORTH_WEST
  Left: {code: 37, name: '\u2190'},                                // also NUM_WEST
  Up: {code: 38, name: '\u2191'},                                  // also NUM_NORTH
  Right: {code: 39, name: '\u2192'},                               // also NUM_EAST
  Down: {code: 40, name: '\u2193'},                                // also NUM_SOUTH
  Delete: {code: 46, name: 'Del'},
  Zero: {code: 48, name: '0'},
  H: {code: 72, name: 'H'},
  N: {code: 78, name: 'N'},
  P: {code: 80, name: 'P'},
  Meta: {code: 91, name: 'Meta'},
  F1: {code: 112, name: 'F1'},
  F2: {code: 113, name: 'F2'},
  F3: {code: 114, name: 'F3'},
  F4: {code: 115, name: 'F4'},
  F5: {code: 116, name: 'F5'},
  F6: {code: 117, name: 'F6'},
  F7: {code: 118, name: 'F7'},
  F8: {code: 119, name: 'F8'},
  F9: {code: 120, name: 'F9'},
  F10: {code: 121, name: 'F10'},
  F11: {code: 122, name: 'F11'},
  F12: {code: 123, name: 'F12'},
  Semicolon: {code: 186, name: ';'},
  NumpadPlus: {code: 107, name: 'Numpad +'},
  NumpadMinus: {code: 109, name: 'Numpad -'},
  Numpad0: {code: 96, name: 'Numpad 0'},
  Plus: {code: 187, name: '+'},
  Comma: {code: 188, name: ','},
  Minus: {code: 189, name: '-'},
  Period: {code: 190, name: '.'},
  Slash: {code: 191, name: '/'},
  QuestionMark: {code: 191, name: '?'},
  Apostrophe: {code: 192, name: '`'},
  Tilde: {code: 192, name: 'Tilde'},
  LeftSquareBracket: {code: 219, name: '['},
  RightSquareBracket: {code: 221, name: ']'},
  Backslash: {code: 220, name: '\\'},
  SingleQuote: {code: 222, name: '\''},
  get CtrlOrMeta() {
    // "default" command/ctrl key for platform, Command on Mac, Ctrl on other platforms
    return Host.isMac() ? this.Meta : this.Ctrl;
  },
};

const KeyBindings = {};

(function() {
for (const key in Keys) {
  const descriptor = Keys[key];
  if (typeof descriptor === 'object' && descriptor['code']) {
    const name = typeof descriptor['name'] === 'string' ? descriptor['name'] : key;
    KeyBindings[name] = descriptor;
  }
}
})();

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.KeyboardShortcut = KeyboardShortcut;

/**
 * Constants for encoding modifier key set as a bit mask.
 * @see #_makeKeyFromCodeAndModifiers
 */
UI.KeyboardShortcut.Modifiers = Modifiers;

/** @type {!Object.<string, !UI.KeyboardShortcut.Key>} */
UI.KeyboardShortcut.Keys = Keys;

UI.KeyboardShortcut.KeyBindings = KeyBindings;

/** @typedef {!{code: number, name: (string|!Object.<string, string>)}} */
UI.KeyboardShortcut.Key;

/** @typedef {!{key: number, name: string}} */
UI.KeyboardShortcut.Descriptor;

var KeyboardShortcut$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': KeyboardShortcut,
  Modifiers: Modifiers,
  Keys: Keys,
  KeyBindings: KeyBindings
});

// Copyright 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @template T
 * @interface
 */
class ListDelegate {
  /**
   * @param {T} item
   * @return {!Element}
   */
  createElementForItem(item) {
  }

  /**
   * This method is not called in NonViewport mode.
   * Return zero to make list measure the item (only works in SameHeight mode).
   * @param {T} item
   * @return {number}
   */
  heightForItem(item) {
  }

  /**
   * @param {T} item
   * @return {boolean}
   */
  isItemSelectable(item) {
  }

  /**
   * @param {?T} from
   * @param {?T} to
   * @param {?Element} fromElement
   * @param {?Element} toElement
   */
  selectedItemChanged(from, to, fromElement, toElement) {
  }
}

/** @enum {symbol} */
const ListMode = {
  NonViewport: Symbol('UI.ListMode.NonViewport'),
  EqualHeightItems: Symbol('UI.ListMode.EqualHeightItems'),
  VariousHeightItems: Symbol('UI.ListMode.VariousHeightItems')
};

/**
 * @template T
 */
class ListControl {
  /**
   * @param {!UI.ListModel<T>} model
   * @param {!ListDelegate<T>} delegate
   * @param {!ListMode=} mode
   */
  constructor(model, delegate, mode) {
    this.element = createElement('div');
    this.element.style.overflowY = 'auto';
    this._topElement = this.element.createChild('div');
    this._bottomElement = this.element.createChild('div');
    this._firstIndex = 0;
    this._lastIndex = 0;
    this._renderedHeight = 0;
    this._topHeight = 0;
    this._bottomHeight = 0;

    this._model = model;
    this._model.addEventListener(UI.ListModel.Events.ItemsReplaced, this._replacedItemsInRange, this);
    /** @type {!Map<T, !Element>} */
    this._itemToElement = new Map();
    this._selectedIndex = -1;
    /** @type {?T} */
    this._selectedItem = null;

    this.element.tabIndex = -1;
    this.element.addEventListener('click', this._onClick.bind(this), false);
    this.element.addEventListener('keydown', this._onKeyDown.bind(this), false);

    this._delegate = delegate;
    this._mode = mode || UI.ListMode.EqualHeightItems;
    this._fixedHeight = 0;
    this._variableOffsets = new Int32Array(0);
    this._clearContents();

    if (this._mode !== UI.ListMode.NonViewport) {
      this.element.addEventListener('scroll', () => {
        this._updateViewport(this.element.scrollTop, this.element.offsetHeight);
      }, false);
    }
  }

  /**
   * @param {!UI.ListModel<T>} model
   */
  setModel(model) {
    this._itemToElement.clear();
    const length = this._model.length;
    this._model.removeEventListener(UI.ListModel.Events.ItemsReplaced, this._replacedItemsInRange, this);
    this._model = model;
    this._model.addEventListener(UI.ListModel.Events.ItemsReplaced, this._replacedItemsInRange, this);
    this.invalidateRange(0, length);
  }

  /**
   * @param {!Common.Event} event
   */
  _replacedItemsInRange(event) {
    const data = /** @type {{index: number, removed: !Array<T>, inserted: number}} */ (event.data);
    const from = data.index;
    const to = from + data.removed.length;

    const oldSelectedItem = this._selectedItem;
    const oldSelectedElement = oldSelectedItem ? (this._itemToElement.get(oldSelectedItem) || null) : null;
    for (let i = 0; i < data.removed.length; i++) {
      this._itemToElement.delete(data.removed[i]);
    }
    this._invalidate(from, to, data.inserted);

    if (this._selectedIndex >= to) {
      this._selectedIndex += data.inserted - (to - from);
      this._selectedItem = this._model.at(this._selectedIndex);
    } else if (this._selectedIndex >= from) {
      let index = this._findFirstSelectable(from + data.inserted, +1, false);
      if (index === -1) {
        index = this._findFirstSelectable(from - 1, -1, false);
      }
      this._select(index, oldSelectedItem, oldSelectedElement);
    }
  }

  /**
   * @param {T} item
   */
  refreshItem(item) {
    const index = this._model.indexOf(item);
    if (index === -1) {
      console.error('Item to refresh is not present');
      return;
    }
    this.refreshItemByIndex(index);
  }

  /**
   * @param {number} index
   */
  refreshItemByIndex(index) {
    const item = this._model.at(index);
    this._itemToElement.delete(item);
    this.invalidateRange(index, index + 1);
    if (this._selectedIndex !== -1) {
      this._select(this._selectedIndex, null, null);
    }
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  invalidateRange(from, to) {
    this._invalidate(from, to, to - from);
  }

  viewportResized() {
    if (this._mode === UI.ListMode.NonViewport) {
      return;
    }
    // TODO(dgozman): try to keep visible scrollTop the same.
    const scrollTop = this.element.scrollTop;
    const viewportHeight = this.element.offsetHeight;
    this._clearViewport();
    this._updateViewport(Number.constrain(scrollTop, 0, this._totalHeight() - viewportHeight), viewportHeight);
  }

  invalidateItemHeight() {
    if (this._mode !== UI.ListMode.EqualHeightItems) {
      console.error('Only supported in equal height items mode');
      return;
    }
    this._fixedHeight = 0;
    if (this._model.length) {
      this._itemToElement.clear();
      this._invalidate(0, this._model.length, this._model.length);
    }
  }

  /**
   * @param {?Node} node
   * @return {?T}
   */
  itemForNode(node) {
    while (node && node.parentNodeOrShadowHost() !== this.element) {
      node = node.parentNodeOrShadowHost();
    }
    if (!node) {
      return null;
    }
    const element = /** @type {!Element} */ (node);
    const index = this._model.findIndex(item => this._itemToElement.get(item) === element);
    return index !== -1 ? this._model.at(index) : null;
  }

  /**
   * @param {T} item
   * @param {boolean=} center
   */
  scrollItemIntoView(item, center) {
    const index = this._model.indexOf(item);
    if (index === -1) {
      console.error('Attempt to scroll onto missing item');
      return;
    }
    this._scrollIntoView(index, center);
  }

  /**
   * @return {?T}
   */
  selectedItem() {
    return this._selectedItem;
  }

  /**
   * @return {number}
   */
  selectedIndex() {
    return this._selectedIndex;
  }

  /**
   * @param {?T} item
   * @param {boolean=} center
   * @param {boolean=} dontScroll
   */
  selectItem(item, center, dontScroll) {
    let index = -1;
    if (item !== null) {
      index = this._model.indexOf(item);
      if (index === -1) {
        console.error('Attempt to select missing item');
        return;
      }
      if (!this._delegate.isItemSelectable(item)) {
        console.error('Attempt to select non-selectable item');
        return;
      }
    }
    // Scrolling the item before selection ensures it is in the DOM.
    if (index !== -1 && !dontScroll) {
      this._scrollIntoView(index, center);
    }
    if (this._selectedIndex !== index) {
      this._select(index);
    }
  }

  /**
   * @param {boolean=} canWrap
   * @param {boolean=} center
   * @return {boolean}
   */
  selectPreviousItem(canWrap, center) {
    if (this._selectedIndex === -1 && !canWrap) {
      return false;
    }
    let index = this._selectedIndex === -1 ? this._model.length - 1 : this._selectedIndex - 1;
    index = this._findFirstSelectable(index, -1, !!canWrap);
    if (index !== -1) {
      this._scrollIntoView(index, center);
      this._select(index);
      return true;
    }
    return false;
  }

  /**
   * @param {boolean=} canWrap
   * @param {boolean=} center
   * @return {boolean}
   */
  selectNextItem(canWrap, center) {
    if (this._selectedIndex === -1 && !canWrap) {
      return false;
    }
    let index = this._selectedIndex === -1 ? 0 : this._selectedIndex + 1;
    index = this._findFirstSelectable(index, +1, !!canWrap);
    if (index !== -1) {
      this._scrollIntoView(index, center);
      this._select(index);
      return true;
    }
    return false;
  }

  /**
   * @param {boolean=} center
   * @return {boolean}
   */
  selectItemPreviousPage(center) {
    if (this._mode === UI.ListMode.NonViewport) {
      return false;
    }
    let index = this._selectedIndex === -1 ? this._model.length - 1 : this._selectedIndex;
    index = this._findPageSelectable(index, -1);
    if (index !== -1) {
      this._scrollIntoView(index, center);
      this._select(index);
      return true;
    }
    return false;
  }

  /**
   * @param {boolean=} center
   * @return {boolean}
   */
  selectItemNextPage(center) {
    if (this._mode === UI.ListMode.NonViewport) {
      return false;
    }
    let index = this._selectedIndex === -1 ? 0 : this._selectedIndex;
    index = this._findPageSelectable(index, +1);
    if (index !== -1) {
      this._scrollIntoView(index, center);
      this._select(index);
      return true;
    }
    return false;
  }

  /**
   * @param {number} index
   * @param {boolean=} center
   */
  _scrollIntoView(index, center) {
    if (this._mode === UI.ListMode.NonViewport) {
      this._elementAtIndex(index).scrollIntoViewIfNeeded(!!center);
      return;
    }

    const top = this._offsetAtIndex(index);
    const bottom = this._offsetAtIndex(index + 1);
    const viewportHeight = this.element.offsetHeight;
    if (center) {
      const scrollTo = (top + bottom) / 2 - viewportHeight / 2;
      this._updateViewport(Number.constrain(scrollTo, 0, this._totalHeight() - viewportHeight), viewportHeight);
      return;
    }

    const scrollTop = this.element.scrollTop;
    if (top < scrollTop) {
      this._updateViewport(top, viewportHeight);
    } else if (bottom > scrollTop + viewportHeight) {
      this._updateViewport(bottom - viewportHeight, viewportHeight);
    }
  }

  /**
   * @param {!Event} event
   */
  _onClick(event) {
    const item = this.itemForNode(/** @type {?Node} */ (event.target));
    if (item && this._delegate.isItemSelectable(item)) {
      this.selectItem(item);
    }
  }

  /**
   * @param {!Event} event
   */
  _onKeyDown(event) {
    let selected = false;
    switch (event.key) {
      case 'ArrowUp':
        selected = this.selectPreviousItem(true, false);
        break;
      case 'ArrowDown':
        selected = this.selectNextItem(true, false);
        break;
      case 'PageUp':
        selected = this.selectItemPreviousPage(false);
        break;
      case 'PageDown':
        selected = this.selectItemNextPage(false);
        break;
    }
    if (selected) {
      event.consume();
    }
  }

  /**
   * @return {number}
   */
  _totalHeight() {
    return this._offsetAtIndex(this._model.length);
  }

  /**
   * @param {number} offset
   * @return {number}
   */
  _indexAtOffset(offset) {
    if (this._mode === UI.ListMode.NonViewport) {
      throw 'There should be no offset conversions in non-viewport mode';
    }
    if (!this._model.length || offset < 0) {
      return 0;
    }
    if (this._mode === UI.ListMode.VariousHeightItems) {
      return Math.min(
          this._model.length - 1, this._variableOffsets.lowerBound(offset, undefined, 0, this._model.length));
    }
    if (!this._fixedHeight) {
      this._measureHeight();
    }
    return Math.min(this._model.length - 1, Math.floor(offset / this._fixedHeight));
  }

  /**
   * @param {number} index
   * @return {!Element}
   */
  _elementAtIndex(index) {
    const item = this._model.at(index);
    let element = this._itemToElement.get(item);
    if (!element) {
      element = this._delegate.createElementForItem(item);
      this._itemToElement.set(item, element);
    }
    return element;
  }

  /**
   * @param {number} index
   * @return {number}
   */
  _offsetAtIndex(index) {
    if (this._mode === UI.ListMode.NonViewport) {
      throw 'There should be no offset conversions in non-viewport mode';
    }
    if (!this._model.length) {
      return 0;
    }
    if (this._mode === UI.ListMode.VariousHeightItems) {
      return this._variableOffsets[index];
    }
    if (!this._fixedHeight) {
      this._measureHeight();
    }
    return index * this._fixedHeight;
  }

  _measureHeight() {
    this._fixedHeight = this._delegate.heightForItem(this._model.at(0));
    if (!this._fixedHeight) {
      this._fixedHeight = UI.measurePreferredSize(this._elementAtIndex(0), this.element).height;
    }
  }

  /**
   * @param {number} index
   * @param {?T=} oldItem
   * @param {?Element=} oldElement
   */
  _select(index, oldItem, oldElement) {
    if (oldItem === undefined) {
      oldItem = this._selectedItem;
    }
    if (oldElement === undefined) {
      oldElement = this._itemToElement.get(oldItem) || null;
    }
    this._selectedIndex = index;
    this._selectedItem = index === -1 ? null : this._model.at(index);
    const newItem = this._selectedItem;
    const newElement = this._selectedIndex !== -1 ? this._elementAtIndex(index) : null;
    if (oldElement) {
      UI.ARIAUtils.setSelected(oldElement, false);
    }
    if (newElement) {
      UI.ARIAUtils.setSelected(newElement, true);
    }
    UI.ARIAUtils.setActiveDescendant(this.element, newElement);
    this._delegate.selectedItemChanged(oldItem, newItem, /** @type {?Element} */ (oldElement), newElement);
  }

  /**
   * @param {number} index
   * @param {number} direction
   * @param {boolean} canWrap
   * @return {number}
   */
  _findFirstSelectable(index, direction, canWrap) {
    const length = this._model.length;
    if (!length) {
      return -1;
    }
    for (let step = 0; step <= length; step++) {
      if (index < 0 || index >= length) {
        if (!canWrap) {
          return -1;
        }
        index = (index + length) % length;
      }
      if (this._delegate.isItemSelectable(this._model.at(index))) {
        return index;
      }
      index += direction;
    }
    return -1;
  }

  /**
   * @param {number} index
   * @param {number} direction
   * @return {number}
   */
  _findPageSelectable(index, direction) {
    let lastSelectable = -1;
    const startOffset = this._offsetAtIndex(index);
    // Compensate for zoom rounding errors with -1.
    const viewportHeight = this.element.offsetHeight - 1;
    while (index >= 0 && index < this._model.length) {
      if (this._delegate.isItemSelectable(this._model.at(index))) {
        if (Math.abs(this._offsetAtIndex(index) - startOffset) >= viewportHeight) {
          return index;
        }
        lastSelectable = index;
      }
      index += direction;
    }
    return lastSelectable;
  }

  /**
   * @param {number} length
   * @param {number} copyTo
   */
  _reallocateVariableOffsets(length, copyTo) {
    if (this._variableOffsets.length < length) {
      const variableOffsets = new Int32Array(Math.max(length, this._variableOffsets.length * 2));
      variableOffsets.set(this._variableOffsets.slice(0, copyTo), 0);
      this._variableOffsets = variableOffsets;
    } else if (this._variableOffsets.length >= 2 * length) {
      const variableOffsets = new Int32Array(length);
      variableOffsets.set(this._variableOffsets.slice(0, copyTo), 0);
      this._variableOffsets = variableOffsets;
    }
  }

  /**
   * @param {number} from
   * @param {number} to
   * @param {number} inserted
   */
  _invalidate(from, to, inserted) {
    if (this._mode === UI.ListMode.NonViewport) {
      this._invalidateNonViewportMode(from, to - from, inserted);
      return;
    }

    if (this._mode === UI.ListMode.VariousHeightItems) {
      this._reallocateVariableOffsets(this._model.length + 1, from + 1);
      for (let i = from + 1; i <= this._model.length; i++) {
        this._variableOffsets[i] = this._variableOffsets[i - 1] + this._delegate.heightForItem(this._model.at(i - 1));
      }
    }

    const viewportHeight = this.element.offsetHeight;
    const totalHeight = this._totalHeight();
    const scrollTop = this.element.scrollTop;

    if (this._renderedHeight < viewportHeight || totalHeight < viewportHeight) {
      this._clearViewport();
      this._updateViewport(Number.constrain(scrollTop, 0, totalHeight - viewportHeight), viewportHeight);
      return;
    }

    const heightDelta = totalHeight - this._renderedHeight;
    if (to <= this._firstIndex) {
      const topHeight = this._topHeight + heightDelta;
      this._topElement.style.height = topHeight + 'px';
      this.element.scrollTop = scrollTop + heightDelta;
      this._topHeight = topHeight;
      this._renderedHeight = totalHeight;
      const indexDelta = inserted - (to - from);
      this._firstIndex += indexDelta;
      this._lastIndex += indexDelta;
      return;
    }

    if (from >= this._lastIndex) {
      const bottomHeight = this._bottomHeight + heightDelta;
      this._bottomElement.style.height = bottomHeight + 'px';
      this._bottomHeight = bottomHeight;
      this._renderedHeight = totalHeight;
      return;
    }

    // TODO(dgozman): try to keep visible scrollTop the same
    // when invalidating after firstIndex but before first visible element.
    this._clearViewport();
    this._updateViewport(Number.constrain(scrollTop, 0, totalHeight - viewportHeight), viewportHeight);
  }

  /**
   * @param {number} start
   * @param {number} remove
   * @param {number} add
   */
  _invalidateNonViewportMode(start, remove, add) {
    let startElement = this._topElement;
    for (let index = 0; index < start; index++) {
      startElement = startElement.nextElementSibling;
    }
    while (remove--) {
      startElement.nextElementSibling.remove();
    }
    while (add--) {
      this.element.insertBefore(this._elementAtIndex(start + add), startElement.nextElementSibling);
    }
  }

  _clearViewport() {
    if (this._mode === UI.ListMode.NonViewport) {
      console.error('There should be no viewport updates in non-viewport mode');
      return;
    }
    this._firstIndex = 0;
    this._lastIndex = 0;
    this._renderedHeight = 0;
    this._topHeight = 0;
    this._bottomHeight = 0;
    this._clearContents();
  }

  _clearContents() {
    // Note: this method should not force layout. Be careful.
    this._topElement.style.height = '0';
    this._bottomElement.style.height = '0';
    this.element.removeChildren();
    this.element.appendChild(this._topElement);
    this.element.appendChild(this._bottomElement);
  }

  /**
   * @param {number} scrollTop
   * @param {number} viewportHeight
   */
  _updateViewport(scrollTop, viewportHeight) {
    // Note: this method should not force layout. Be careful.
    if (this._mode === UI.ListMode.NonViewport) {
      console.error('There should be no viewport updates in non-viewport mode');
      return;
    }
    const totalHeight = this._totalHeight();
    if (!totalHeight) {
      this._firstIndex = 0;
      this._lastIndex = 0;
      this._topHeight = 0;
      this._bottomHeight = 0;
      this._renderedHeight = 0;
      this._topElement.style.height = '0';
      this._bottomElement.style.height = '0';
      return;
    }

    const firstIndex = this._indexAtOffset(scrollTop - viewportHeight);
    const lastIndex = this._indexAtOffset(scrollTop + 2 * viewportHeight) + 1;

    while (this._firstIndex < Math.min(firstIndex, this._lastIndex)) {
      this._elementAtIndex(this._firstIndex).remove();
      this._firstIndex++;
    }
    while (this._lastIndex > Math.max(lastIndex, this._firstIndex)) {
      this._elementAtIndex(this._lastIndex - 1).remove();
      this._lastIndex--;
    }

    this._firstIndex = Math.min(this._firstIndex, lastIndex);
    this._lastIndex = Math.max(this._lastIndex, firstIndex);
    for (let index = this._firstIndex - 1; index >= firstIndex; index--) {
      const element = this._elementAtIndex(index);
      this.element.insertBefore(element, this._topElement.nextSibling);
    }
    for (let index = this._lastIndex; index < lastIndex; index++) {
      const element = this._elementAtIndex(index);
      this.element.insertBefore(element, this._bottomElement);
    }

    this._firstIndex = firstIndex;
    this._lastIndex = lastIndex;
    this._topHeight = this._offsetAtIndex(firstIndex);
    this._topElement.style.height = this._topHeight + 'px';
    this._bottomHeight = totalHeight - this._offsetAtIndex(lastIndex);
    this._bottomElement.style.height = this._bottomHeight + 'px';
    this._renderedHeight = totalHeight;
    this.element.scrollTop = scrollTop;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ListControl = ListControl;

/** @interface */
UI.ListDelegate = ListDelegate;

UI.ListMode = ListMode;

var ListControl$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  ListDelegate: ListDelegate,
  ListMode: ListMode,
  'default': ListControl
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @implements {Iterable<T>}
 * @template T
 */
class ListModel extends Common.Object {
  /**
   * @param {!Array<T>=} items
   */
  constructor(items) {
    super();
    this._items = items || [];
  }

  /**
   * @return {!Iterator<T>}
   */
  [Symbol.iterator]() {
    return this._items[Symbol.iterator]();
  }

  /**
   * @return {number}
   */
  get length() {
    return this._items.length;
  }

  /**
   * @param {number} index
   * @return {T}
   */
  at(index) {
    return this._items[index];
  }

  /**
   * @param {function(T):boolean} callback
   * @return {boolean}
   */
  every(callback) {
    return this._items.every(callback);
  }

  /**
   * @param {function(T):boolean} callback
   * @return {!Array<T>}
   */
  filter(callback) {
    return this._items.filter(callback);
  }

  /**
   * @param {function(T):boolean} callback
   * @return {T|undefined}
   */
  find(callback) {
    return this._items.find(callback);
  }

  /**
   * @param {function(T):boolean} callback
   * @return {number}
   */
  findIndex(callback) {
    return this._items.findIndex(callback);
  }

  /**
   * @param {T} value
   * @param {number=} fromIndex
   * @return {number}
   */
  indexOf(value, fromIndex) {
    return this._items.indexOf(value, fromIndex);
  }

  /**
   * @param {number} index
   * @param {T} value
   */
  insert(index, value) {
    this._items.splice(index, 0, value);
    this._replaced(index, [], 1);
  }

  /**
   * @param {T} value
   * @param {function(T, T):number} comparator
   */
  insertWithComparator(value, comparator) {
    this.insert(this._items.lowerBound(value, comparator), value);
  }

  /**
   * @param {string=} separator
   * @return {string}
   */
  join(separator) {
    return this._items.join(separator);
  }

  /**
   * @param {number} index
   * @return {T}
   */
  remove(index) {
    const result = this._items[index];
    this._items.splice(index, 1);
    this._replaced(index, [result], 0);
    return result;
  }

  /**
   * @param {number} index
   * @param {T} value
   * @return {T}
   */
  replace(index, value) {
    const oldValue = this._items[index];
    this._items[index] = value;
    this._replaced(index, [oldValue], 1);
    return oldValue;
  }

  /**
   * @param {number} from
   * @param {number} to
   * @param {!Array<T>} items
   * @return {!Array<T>} removed
   */
  replaceRange(from, to, items) {
    let removed;
    if (items.length < 10000) {
      removed = this._items.splice(from, to - from, ...items);
    } else {
      removed = this._items.slice(from, to);
      // Splice may fail with too many arguments.
      const before = this._items.slice(0, from);
      const after = this._items.slice(to);
      this._items = [].concat(before, items, after);
    }
    this._replaced(from, removed, items.length);
    return removed;
  }

  /**
   * @param {!Array<T>} items
   * @return {!Array<T>}
   */
  replaceAll(items) {
    const oldItems = this._items.slice();
    this._items = items;
    this._replaced(0, oldItems, items.length);
    return oldItems;
  }

  /**
   * @param {number=} from
   * @param {number=} to
   * @return {!Array<T>}
   */
  slice(from, to) {
    return this._items.slice(from, to);
  }

  /**
   * @param {function(T):boolean} callback
   * @return {boolean}
   */
  some(callback) {
    return this._items.some(callback);
  }

  /**
   * @param {number} index
   * @param {!Array<T>} removed
   * @param {number} inserted
   */
  _replaced(index, removed, inserted) {
    this.dispatchEventToListeners(Events$7.ItemsReplaced, {index: index, removed: removed, inserted: inserted});
  }
}

/** @enum {symbol} */
const Events$7 = {
  ItemsReplaced: Symbol('ItemsReplaced'),
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ListModel = ListModel;

/** @enum {symbol} */
UI.ListModel.Events = Events$7;

var ListModel$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ListModel,
  Events: Events$7
});

// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @template T
 */
class ListWidget extends UI.VBox {
  /**
   * @param {!Delegate<T>} delegate
   */
  constructor(delegate) {
    super(true, true /* delegatesFocus */);
    this.registerRequiredCSS('ui/listWidget.css');
    this._delegate = delegate;

    this._list = this.contentElement.createChild('div', 'list');

    this._lastSeparator = false;
    /** @type {?UI.ElementFocusRestorer} */
    this._focusRestorer = null;
    /** @type {!Array<T>} */
    this._items = [];
    /** @type {!Array<boolean>} */
    this._editable = [];
    /** @type {!Array<!Element>} */
    this._elements = [];
    /** @type {?Editor<T>} */
    this._editor = null;
    /** @type {?T} */
    this._editItem = null;
    /** @type {?Element} */
    this._editElement = null;

    /** @type {?Element} */
    this._emptyPlaceholder = null;

    this._updatePlaceholder();
  }

  clear() {
    this._items = [];
    this._editable = [];
    this._elements = [];
    this._lastSeparator = false;
    this._list.removeChildren();
    this._updatePlaceholder();
    this._stopEditing();
  }

  /**
   * @param {!T} item
   * @param {boolean} editable
   */
  appendItem(item, editable) {
    if (this._lastSeparator && this._items.length) {
      this._list.appendChild(createElementWithClass('div', 'list-separator'));
    }
    this._lastSeparator = false;

    this._items.push(item);
    this._editable.push(editable);

    const element = this._list.createChild('div', 'list-item');
    element.appendChild(this._delegate.renderItem(item, editable));
    if (editable) {
      element.classList.add('editable');
      element.appendChild(this._createControls(item, element));
    }
    this._elements.push(element);
    this._updatePlaceholder();
  }

  appendSeparator() {
    this._lastSeparator = true;
  }

  /**
   * @param {number} index
   */
  removeItem(index) {
    if (this._editItem === this._items[index]) {
      this._stopEditing();
    }

    const element = this._elements[index];

    const previous = element.previousElementSibling;
    const previousIsSeparator = previous && previous.classList.contains('list-separator');

    const next = element.nextElementSibling;
    const nextIsSeparator = next && next.classList.contains('list-separator');

    if (previousIsSeparator && (nextIsSeparator || !next)) {
      previous.remove();
    }
    if (nextIsSeparator && !previous) {
      next.remove();
    }
    element.remove();

    this._elements.splice(index, 1);
    this._items.splice(index, 1);
    this._editable.splice(index, 1);
    this._updatePlaceholder();
  }

  /**
   * @param {number} index
   * @param {!T} item
   */
  addNewItem(index, item) {
    this._startEditing(item, null, this._elements[index] || null);
  }

  /**
   * @param {?Element} element
   */
  setEmptyPlaceholder(element) {
    this._emptyPlaceholder = element;
    this._updatePlaceholder();
  }

  /**
   * @param {!T} item
   * @param {!Element} element
   * @return {!Element}
   */
  _createControls(item, element) {
    const controls = createElementWithClass('div', 'controls-container fill');
    controls.createChild('div', 'controls-gradient');

    const buttons = controls.createChild('div', 'controls-buttons');

    const toolbar = new UI.Toolbar('', buttons);

    const editButton = new UI.ToolbarButton(Common.UIString('Edit'), 'largeicon-edit');
    editButton.addEventListener(UI.ToolbarButton.Events.Click, onEditClicked.bind(this));
    toolbar.appendToolbarItem(editButton);

    const removeButton = new UI.ToolbarButton(Common.UIString('Remove'), 'largeicon-trash-bin');
    removeButton.addEventListener(UI.ToolbarButton.Events.Click, onRemoveClicked.bind(this));
    toolbar.appendToolbarItem(removeButton);

    return controls;

    /**
     * @this {ListWidget}
     */
    function onEditClicked() {
      const index = this._elements.indexOf(element);
      const insertionPoint = this._elements[index + 1] || null;
      this._startEditing(item, element, insertionPoint);
    }

    /**
     * @this {ListWidget}
     */
    function onRemoveClicked() {
      const index = this._elements.indexOf(element);
      this.element.focus();
      this._delegate.removeItemRequested(this._items[index], index);
    }
  }

  /**
   * @override
   */
  wasShown() {
    super.wasShown();
    this._stopEditing();
  }

  _updatePlaceholder() {
    if (!this._emptyPlaceholder) {
      return;
    }

    if (!this._elements.length && !this._editor) {
      this._list.appendChild(this._emptyPlaceholder);
    } else {
      this._emptyPlaceholder.remove();
    }
  }

  /**
   * @param {!T} item
   * @param {?Element} element
   * @param {?Element} insertionPoint
   */
  _startEditing(item, element, insertionPoint) {
    if (element && this._editElement === element) {
      return;
    }

    this._stopEditing();
    this._focusRestorer = new UI.ElementFocusRestorer(this.element);

    this._list.classList.add('list-editing');
    this._editItem = item;
    this._editElement = element;
    if (element) {
      element.classList.add('hidden');
    }

    const index = element ? this._elements.indexOf(element) : -1;
    this._editor = this._delegate.beginEdit(item);
    this._updatePlaceholder();
    this._list.insertBefore(this._editor.element, insertionPoint);
    this._editor.beginEdit(
        item, index, element ? Common.UIString('Save') : Common.UIString('Add'), this._commitEditing.bind(this),
        this._stopEditing.bind(this));
  }

  _commitEditing() {
    const editItem = this._editItem;
    const isNew = !this._editElement;
    const editor = /** @type {!Editor<T>} */ (this._editor);
    this._stopEditing();
    this._delegate.commitEdit(editItem, editor, isNew);
  }

  _stopEditing() {
    this._list.classList.remove('list-editing');
    if (this._focusRestorer) {
      this._focusRestorer.restore();
    }
    if (this._editElement) {
      this._editElement.classList.remove('hidden');
    }
    if (this._editor && this._editor.element.parentElement) {
      this._editor.element.remove();
    }

    this._editor = null;
    this._editItem = null;
    this._editElement = null;
    this._updatePlaceholder();
  }
}

/**
 * @template T
 * @interface
 */
class Delegate$1 {
  /**
   * @param {!T} item
   * @param {boolean} editable
   * @return {!Element}
   */
  renderItem(item, editable) {
  }

  /**
   * @param {!T} item
   * @param {number} index
   */
  removeItemRequested(item, index) {
  }

  /**
   * @param {!T} item
   * @return {!Editor<T>}
   */
  beginEdit(item) {
  }

  /**
   * @param {!T} item
   * @param {!Editor<T>} editor
   * @param {boolean} isNew
   */
  commitEdit(item, editor, isNew) {}
}

/**
 * @template T
 */
class Editor {
  constructor() {
    this.element = createElementWithClass('div', 'editor-container');
    this.element.addEventListener('keydown', onKeyDown.bind(null, isEscKey, this._cancelClicked.bind(this)), false);
    this.element.addEventListener('keydown', onKeyDown.bind(null, isEnterKey, this._commitClicked.bind(this)), false);

    this._contentElement = this.element.createChild('div', 'editor-content');

    const buttonsRow = this.element.createChild('div', 'editor-buttons');
    this._commitButton = UI.createTextButton('', this._commitClicked.bind(this), '', true /* primary */);
    buttonsRow.appendChild(this._commitButton);
    this._cancelButton = UI.createTextButton(Common.UIString('Cancel'), this._cancelClicked.bind(this));
    this._cancelButton.addEventListener(
        'keydown', onKeyDown.bind(null, isEnterKey, this._cancelClicked.bind(this)), false);
    buttonsRow.appendChild(this._cancelButton);

    this._errorMessageContainer = this.element.createChild('div', 'list-widget-input-validation-error');
    UI.ARIAUtils.markAsAlert(this._errorMessageContainer);

    /**
     * @param {function(!Event):boolean} predicate
     * @param {function()} callback
     * @param {!Event} event
     */
    function onKeyDown(predicate, callback, event) {
      if (predicate(event)) {
        event.consume(true);
        callback();
      }
    }

    /** @type {!Array<!HTMLInputElement|!HTMLSelectElement>} */
    this._controls = [];
    /** @type {!Map<string, !HTMLInputElement|!HTMLSelectElement>} */
    this._controlByName = new Map();
    /** @type {!Array<function(!T, number, (!HTMLInputElement|!HTMLSelectElement)): !UI.ListWidget.ValidatorResult>} */
    this._validators = [];

    /** @type {?function()} */
    this._commit = null;
    /** @type {?function()} */
    this._cancel = null;
    /** @type {?T} */
    this._item = null;
    /** @type {number} */
    this._index = -1;
  }

  /**
   * @return {!Element}
   */
  contentElement() {
    return this._contentElement;
  }

  /**
   * @param {string} name
   * @param {string} type
   * @param {string} title
   * @param {function(!T, number, (!HTMLInputElement|!HTMLSelectElement)): !UI.ListWidget.ValidatorResult} validator
   * @return {!HTMLInputElement}
   */
  createInput(name, type, title, validator) {
    const input = /** @type {!HTMLInputElement} */ (UI.createInput('', type));
    input.placeholder = title;
    input.addEventListener('input', this._validateControls.bind(this, false), false);
    input.addEventListener('blur', this._validateControls.bind(this, false), false);
    UI.ARIAUtils.setAccessibleName(input, title);
    this._controlByName.set(name, input);
    this._controls.push(input);
    this._validators.push(validator);
    return input;
  }

  /**
   * @param {string} name
   * @param {!Array<string>} options
   * @param {function(!T, number, (!HTMLInputElement|!HTMLSelectElement)): !UI.ListWidget.ValidatorResult} validator
   * @param {string=} title
   * @return {!HTMLSelectElement}
   */
  createSelect(name, options, validator, title) {
    const select = /** @type {!HTMLSelectElement} */ (createElementWithClass('select', 'chrome-select'));
    for (let index = 0; index < options.length; ++index) {
      const option = select.createChild('option');
      option.value = options[index];
      option.textContent = options[index];
    }
    if (title) {
      select.title = title;
      UI.ARIAUtils.setAccessibleName(select, title);
    }
    select.addEventListener('input', this._validateControls.bind(this, false), false);
    select.addEventListener('blur', this._validateControls.bind(this, false), false);
    this._controlByName.set(name, select);
    this._controls.push(select);
    this._validators.push(validator);
    return select;
  }

  /**
   * @param {string} name
   * @return {!HTMLInputElement|!HTMLSelectElement}
   */
  control(name) {
    return /** @type {!HTMLInputElement|!HTMLSelectElement} */ (this._controlByName.get(name));
  }

  /**
   * @param {boolean} forceValid
   */
  _validateControls(forceValid) {
    let allValid = true;
    this._errorMessageContainer.textContent = '';
    for (let index = 0; index < this._controls.length; ++index) {
      const input = this._controls[index];
      const {valid, errorMessage} = this._validators[index].call(null, this._item, this._index, input);

      input.classList.toggle('error-input', !valid && !forceValid);
      if (valid || forceValid) {
        UI.ARIAUtils.setInvalid(input, false);
      } else {
        UI.ARIAUtils.setInvalid(input, true);
      }

      if (!forceValid && errorMessage && !this._errorMessageContainer.textContent) {
        this._errorMessageContainer.textContent = errorMessage;
      }

      allValid &= valid;
    }
    this._commitButton.disabled = !allValid;
  }

  /**
   * @param {!T} item
   * @param {number} index
   * @param {string} commitButtonTitle
   * @param {function()} commit
   * @param {function()} cancel
   */
  beginEdit(item, index, commitButtonTitle, commit, cancel) {
    this._commit = commit;
    this._cancel = cancel;
    this._item = item;
    this._index = index;

    this._commitButton.textContent = commitButtonTitle;
    this.element.scrollIntoViewIfNeeded(false);
    if (this._controls.length) {
      this._controls[0].focus();
    }
    this._validateControls(true);
  }

  _commitClicked() {
    if (this._commitButton.disabled) {
      return;
    }

    const commit = this._commit;
    this._commit = null;
    this._cancel = null;
    this._item = null;
    this._index = -1;
    commit();
  }

  _cancelClicked() {
    const cancel = this._cancel;
    this._commit = null;
    this._cancel = null;
    this._item = null;
    this._index = -1;
    cancel();
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ListWidget = ListWidget;

/**
 * @template T
 * @interface
 */
UI.ListWidget.Delegate = Delegate$1;

/**
 * @constructor
 */
UI.ListWidget.Editor = Editor;

/** @typedef {{valid: boolean, errorMessage: (string|undefined)}} */
UI.ListWidget.ValidatorResult;

var ListWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ListWidget,
  Delegate: Delegate$1,
  Editor: Editor
});

/*
 * Copyright (C) 2007, 2008 Apple Inc.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class Panel extends UI.VBox {
  /**
   * @param {string} name
   */
  constructor(name) {
    super();

    this.element.classList.add('panel');
    this.element.setAttribute('aria-label', name);
    this.element.classList.add(name);
    this._panelName = name;

    // For testing.
    UI.panels[name] = this;
  }

  get name() {
    return this._panelName;
  }

  /**
   * @return {?UI.SearchableView}
   */
  searchableView() {
    return null;
  }

  /**
   * @override
   * @return {!Array.<!Element>}
   */
  elementsToRestoreScrollPositionsFor() {
    return [];
  }
}

/**
 * @unrestricted
 */
class PanelWithSidebar extends Panel {
  /**
   * @param {string} name
   * @param {number=} defaultWidth
   */
  constructor(name, defaultWidth) {
    super(name);

    this._panelSplitWidget =
        new UI.SplitWidget(true, false, this._panelName + 'PanelSplitViewState', defaultWidth || 200);
    this._panelSplitWidget.show(this.element);

    this._mainWidget = new UI.VBox();
    this._panelSplitWidget.setMainWidget(this._mainWidget);

    this._sidebarWidget = new UI.VBox();
    this._sidebarWidget.setMinimumSize(100, 25);
    this._panelSplitWidget.setSidebarWidget(this._sidebarWidget);

    this._sidebarWidget.element.classList.add('panel-sidebar');
  }

  /**
   * @return {!Element}
   */
  panelSidebarElement() {
    return this._sidebarWidget.element;
  }

  /**
   * @return {!Element}
   */
  mainElement() {
    return this._mainWidget.element;
  }

  /**
   * @return {!UI.SplitWidget}
   */
  splitWidget() {
    return this._panelSplitWidget;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Panel = Panel;

/** @constructor */
UI.PanelWithSidebar = PanelWithSidebar;

// For testing.
UI.panels = {};

var Panel$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Panel,
  PanelWithSidebar: PanelWithSidebar
});

/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

class PopoverHelper {
  /**
   * @param {!Element} container
   * @param {function(!MouseEvent):?UI.PopoverRequest} getRequest
   */
  constructor(container, getRequest) {
    this._disableOnClick = false;
    this._hasPadding = false;
    this._getRequest = getRequest;
    this._scheduledRequest = null;
    /** @type {?function()} */
    this._hidePopoverCallback = null;
    this._container = container;
    this._showTimeout = 0;
    this._hideTimeout = 0;
    /** @type {?number} */
    this._hidePopoverTimer = null;
    /** @type {?number} */
    this._showPopoverTimer = null;
    this._boundMouseDown = this._mouseDown.bind(this);
    this._boundMouseMove = this._mouseMove.bind(this);
    this._boundMouseOut = this._mouseOut.bind(this);
    this._container.addEventListener('mousedown', this._boundMouseDown, false);
    this._container.addEventListener('mousemove', this._boundMouseMove, false);
    this._container.addEventListener('mouseout', this._boundMouseOut, false);
    this.setTimeout(1000);
  }

  /**
   * @param {number} showTimeout
   * @param {number=} hideTimeout
   */
  setTimeout(showTimeout, hideTimeout) {
    this._showTimeout = showTimeout;
    this._hideTimeout = typeof hideTimeout === 'number' ? hideTimeout : showTimeout / 2;
  }

  /**
   * @param {boolean} hasPadding
   */
  setHasPadding(hasPadding) {
    this._hasPadding = hasPadding;
  }

  /**
   * @param {boolean} disableOnClick
   */
  setDisableOnClick(disableOnClick) {
    this._disableOnClick = disableOnClick;
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  _eventInScheduledContent(event) {
    return this._scheduledRequest ? this._scheduledRequest.box.contains(event.clientX, event.clientY) : false;
  }

  /**
   * @param {!Event} event
   */
  _mouseDown(event) {
    if (this._disableOnClick) {
      this.hidePopover();
      return;
    }
    if (this._eventInScheduledContent(event)) {
      return;
    }

    this._startHidePopoverTimer(0);
    this._stopShowPopoverTimer();
    this._startShowPopoverTimer(/** @type {!MouseEvent} */ (event), 0);
  }

  /**
   * @param {!Event} event
   */
  _mouseMove(event) {
    // Pretend that nothing has happened.
    if (this._eventInScheduledContent(event)) {
      return;
    }

    this._startHidePopoverTimer(this._hideTimeout);
    this._stopShowPopoverTimer();
    if (event.which && this._disableOnClick) {
      return;
    }
    this._startShowPopoverTimer(
        /** @type {!MouseEvent} */ (event), this.isPopoverVisible() ? this._showTimeout * 0.6 : this._showTimeout);
  }

  /**
   * @param {!Event} event
   */
  _popoverMouseMove(event) {
    this._stopHidePopoverTimer();
  }

  /**
   * @param {!UI.GlassPane} popover
   * @param {!Event} event
   */
  _popoverMouseOut(popover, event) {
    if (!popover.isShowing()) {
      return;
    }
    if (event.relatedTarget && !event.relatedTarget.isSelfOrDescendant(popover.contentElement)) {
      this._startHidePopoverTimer(this._hideTimeout);
    }
  }

  /**
   * @param {!Event} event
   */
  _mouseOut(event) {
    if (!this.isPopoverVisible()) {
      return;
    }
    if (!this._eventInScheduledContent(event)) {
      this._startHidePopoverTimer(this._hideTimeout);
    }
  }

  /**
   * @param {number} timeout
   */
  _startHidePopoverTimer(timeout) {
    // User has |timeout| ms to reach the popup.
    if (!this._hidePopoverCallback || this._hidePopoverTimer) {
      return;
    }

    this._hidePopoverTimer = setTimeout(() => {
      this._hidePopover();
      this._hidePopoverTimer = null;
    }, timeout);
  }

  /**
   * @param {!MouseEvent} event
   * @param {number} timeout
   */
  _startShowPopoverTimer(event, timeout) {
    this._scheduledRequest = this._getRequest.call(null, event);
    if (!this._scheduledRequest) {
      return;
    }

    this._showPopoverTimer = setTimeout(() => {
      this._showPopoverTimer = null;
      this._stopHidePopoverTimer();
      this._hidePopover();
      this._showPopover(event.target.ownerDocument);
    }, timeout);
  }

  _stopShowPopoverTimer() {
    if (!this._showPopoverTimer) {
      return;
    }
    clearTimeout(this._showPopoverTimer);
    this._showPopoverTimer = null;
  }

  /**
   * @return {boolean}
   */
  isPopoverVisible() {
    return !!this._hidePopoverCallback;
  }

  hidePopover() {
    this._stopShowPopoverTimer();
    this._hidePopover();
  }

  _hidePopover() {
    if (!this._hidePopoverCallback) {
      return;
    }
    this._hidePopoverCallback.call(null);
    this._hidePopoverCallback = null;
  }

  /**
   * @param {!Document} document
   */
  _showPopover(document) {
    const popover = new UI.GlassPane();
    popover.registerRequiredCSS('ui/popover.css');
    popover.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
    popover.setMarginBehavior(UI.GlassPane.MarginBehavior.Arrow);
    const request = this._scheduledRequest;
    request.show.call(null, popover).then(success => {
      if (!success) {
        return;
      }

      if (this._scheduledRequest !== request) {
        if (request.hide) {
          request.hide.call(null);
        }
        return;
      }

      // This should not happen, but we hide previous popover to be on the safe side.
      if (PopoverHelper._popoverHelper) {
        console.error('One popover is already visible');
        PopoverHelper._popoverHelper.hidePopover();
      }
      PopoverHelper._popoverHelper = this;

      popover.contentElement.classList.toggle('has-padding', this._hasPadding);
      popover.contentElement.addEventListener('mousemove', this._popoverMouseMove.bind(this), true);
      popover.contentElement.addEventListener('mouseout', this._popoverMouseOut.bind(this, popover), true);
      popover.setContentAnchorBox(request.box);
      popover.show(document);

      this._hidePopoverCallback = () => {
        if (request.hide) {
          request.hide.call(null);
        }
        popover.hide();
        delete PopoverHelper._popoverHelper;
      };
    });
  }

  _stopHidePopoverTimer() {
    if (!this._hidePopoverTimer) {
      return;
    }
    clearTimeout(this._hidePopoverTimer);
    this._hidePopoverTimer = null;

    // We know that we reached the popup, but we might have moved over other elements.
    // Discard pending command.
    this._stopShowPopoverTimer();
  }

  dispose() {
    this._container.removeEventListener('mousedown', this._boundMouseDown, false);
    this._container.removeEventListener('mousemove', this._boundMouseMove, false);
    this._container.removeEventListener('mouseout', this._boundMouseOut, false);
  }
}

/** @typedef {{box: !AnchorBox, show:(function(!UI.GlassPane):!Promise<boolean>), hide:(function()|undefined)}} */
UI.PopoverRequest;

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.PopoverHelper = PopoverHelper;

var PopoverHelper$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': PopoverHelper
});

/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * @implements {Common.Progress}
 * @unrestricted
 */
class ProgressIndicator {
  constructor() {
    this.element = createElementWithClass('div', 'progress-indicator');
    this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, 'ui/progressIndicator.css');
    this._contentElement = this._shadowRoot.createChild('div', 'progress-indicator-shadow-container');

    this._labelElement = this._contentElement.createChild('div', 'title');
    this._progressElement = this._contentElement.createChild('progress');
    this._progressElement.value = 0;
    this._stopButton = this._contentElement.createChild('button', 'progress-indicator-shadow-stop-button');
    this._stopButton.addEventListener('click', this.cancel.bind(this));

    this._isCanceled = false;
    this._worked = 0;
  }

  /**
   * @param {!Element} parent
   */
  show(parent) {
    parent.appendChild(this.element);
  }

  /**
   * @override
   */
  done() {
    if (this._isDone) {
      return;
    }
    this._isDone = true;
    this.element.remove();
  }

  cancel() {
    this._isCanceled = true;
  }

  /**
   * @override
   * @return {boolean}
   */
  isCanceled() {
    return this._isCanceled;
  }

  /**
   * @override
   * @param {string} title
   */
  setTitle(title) {
    this._labelElement.textContent = title;
  }

  /**
   * @override
   * @param {number} totalWork
   */
  setTotalWork(totalWork) {
    this._progressElement.max = totalWork;
  }

  /**
   * @override
   * @param {number} worked
   * @param {string=} title
   */
  setWorked(worked, title) {
    this._worked = worked;
    this._progressElement.value = worked;
    if (title) {
      this.setTitle(title);
    }
  }

  /**
   * @override
   * @param {number=} worked
   */
  worked(worked) {
    this.setWorked(this._worked + (worked || 1));
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ProgressIndicator = ProgressIndicator;

var ProgressIndicator$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ProgressIndicator
});

// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class RemoteDebuggingTerminatedScreen extends UI.VBox {
  /**
   * @param {string} reason
   */
  constructor(reason) {
    super(true);
    this.registerRequiredCSS('ui/remoteDebuggingTerminatedScreen.css');
    const message = this.contentElement.createChild('div', 'message');
    const reasonElement = message.createChild('span', 'reason');
    reasonElement.textContent = reason;
    message.appendChild(UI.formatLocalized('Debugging connection was closed. Reason: %s', [reasonElement]));
    this.contentElement.createChild('div', 'message').textContent =
        Common.UIString('Reconnect when ready by reopening DevTools.');
    const button = UI.createTextButton(Common.UIString('Reconnect DevTools'), () => window.location.reload());
    this.contentElement.createChild('div', 'button').appendChild(button);
  }

  /**
   * @param {string} reason
   */
  static show(reason) {
    const dialog = new UI.Dialog();
    dialog.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
    dialog.addCloseButton();
    dialog.setDimmed(true);
    new RemoteDebuggingTerminatedScreen(reason).show(dialog.contentElement);
    dialog.show();
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.RemoteDebuggingTerminatedScreen = RemoteDebuggingTerminatedScreen;

var RemoteDebuggingTerminatedScreen$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': RemoteDebuggingTerminatedScreen
});

// Copyright (c) 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ReportView extends UI.VBox {
  /**
   * @param {string=} title
   */
  constructor(title) {
    super(true);
    this.registerRequiredCSS('ui/reportView.css');

    this._contentBox = this.contentElement.createChild('div', 'report-content-box');
    this._headerElement = this._contentBox.createChild('div', 'report-header vbox');
    this._titleElement = this._headerElement.createChild('div', 'report-title');
    this._titleElement.textContent = title;
    UI.ARIAUtils.markAsHeading(this._titleElement, 1);

    this._sectionList = this._contentBox.createChild('div', 'vbox');
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    if (this._titleElement.textContent === title) {
      return;
    }
    this._titleElement.textContent = title;
  }

  /**
   * @param {string} subtitle
   */
  setSubtitle(subtitle) {
    if (this._subtitleElement && this._subtitleElement.textContent === subtitle) {
      return;
    }
    if (!this._subtitleElement) {
      this._subtitleElement = this._headerElement.createChild('div', 'report-subtitle');
    }
    this._subtitleElement.textContent = subtitle;
  }

  /**
   * @param {?Element} link
   */
  setURL(link) {
    if (!this._urlElement) {
      this._urlElement = this._headerElement.createChild('div', 'report-url link');
    }
    this._urlElement.removeChildren();
    if (link) {
      this._urlElement.appendChild(link);
    }
  }

  /**
   * @return {!UI.Toolbar}
   */
  createToolbar() {
    const toolbar = new UI.Toolbar('');
    this._headerElement.appendChild(toolbar.element);
    return toolbar;
  }

  /**
   * @param {string} title
   * @param {string=} className
   * @return {!Section}
   */
  appendSection(title, className) {
    const section = new Section(title, className);
    section.show(this._sectionList);
    return section;
  }

  /**
   * @param {function(!Section, !Section): number} comparator
   */
  sortSections(comparator) {
    const sections = /** @type {!Array<!Section>} */ (this.children().slice());
    const sorted = sections.every((e, i, a) => !i || comparator(a[i - 1], a[i]) <= 0);
    if (sorted) {
      return;
    }

    this.detachChildWidgets();
    sections.sort(comparator);
    for (const section of sections) {
      section.show(this._sectionList);
    }
  }

  /**
   * @param {boolean} visible
   */
  setHeaderVisible(visible) {
    this._headerElement.classList.toggle('hidden', !visible);
  }


  /**
   * @param {boolean} scrollable
   */
  setBodyScrollable(scrollable) {
    this._contentBox.classList.toggle('no-scroll', !scrollable);
  }
}

/**
 * @unrestricted
 */
class Section extends UI.VBox {
  /**
   * @param {string} title
   * @param {string=} className
   */
  constructor(title, className) {
    super();
    this.element.classList.add('report-section');
    if (className) {
      this.element.classList.add(className);
    }
    this._headerElement = this.element.createChild('div', 'report-section-header');
    this._titleElement = this._headerElement.createChild('div', 'report-section-title');
    this.setTitle(title);
    UI.ARIAUtils.markAsHeading(this._titleElement, 2);
    this._fieldList = this.element.createChild('div', 'vbox');
    /** @type {!Map.<string, !Element>} */
    this._fieldMap = new Map();
  }

  /**
   * @return {string}
   */
  title() {
    return this._titleElement.textContent;
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    if (this._titleElement.textContent !== title) {
      this._titleElement.textContent = title;
    }
    this._titleElement.classList.toggle('hidden', !this._titleElement.textContent);
  }

  /**
   * Declares the overall container to be a group and assigns a title.
   * @param {string} groupTitle
   */
  setUiGroupTitle(groupTitle) {
    UI.ARIAUtils.markAsGroup(this.element);
    UI.ARIAUtils.setAccessibleName(this.element, groupTitle);
  }

  /**
   * @return {!UI.Toolbar}
   */
  createToolbar() {
    const toolbar = new UI.Toolbar('');
    this._headerElement.appendChild(toolbar.element);
    return toolbar;
  }

  /**
   * @param {string} title
   * @param {string=} textValue
   * @return {!Element}
   */
  appendField(title, textValue) {
    let row = this._fieldMap.get(title);
    if (!row) {
      row = this._fieldList.createChild('div', 'report-field');
      row.createChild('div', 'report-field-name').textContent = title;
      this._fieldMap.set(title, row);
      row.createChild('div', 'report-field-value');
    }
    if (textValue) {
      row.lastElementChild.textContent = textValue;
    }
    return /** @type {!Element} */ (row.lastElementChild);
  }

  /**
   * @param {string} title
   */
  removeField(title) {
    const row = this._fieldMap.get(title);
    if (row) {
      row.remove();
    }
    this._fieldMap.delete(title);
  }

  /**
   * @param {string} title
   * @param {boolean} visible
   */
  setFieldVisible(title, visible) {
    const row = this._fieldMap.get(title);
    if (row) {
      row.classList.toggle('hidden', !visible);
    }
  }

  /**
   * @param {string} title
   * @return {?Element}
   */
  fieldValue(title) {
    const row = this._fieldMap.get(title);
    return row ? row.lastElementChild : null;
  }

  /**
   * @return {!Element}
   */
  appendRow() {
    return this._fieldList.createChild('div', 'report-row');
  }

  /**
   * @return {!Element}
   */
  appendSelectableRow() {
    return this._fieldList.createChild('div', 'report-row report-row-selectable');
  }

  clearContent() {
    this._fieldList.removeChildren();
    this._fieldMap.clear();
  }

  markFieldListAsGroup() {
    UI.ARIAUtils.markAsGroup(this._fieldList);
    UI.ARIAUtils.setAccessibleName(this._fieldList, this.title());
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ReportView = ReportView;

/**
 * @constructor
 */
UI.ReportView.Section = Section;

var ReportView$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ReportView,
  Section: Section
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ResizerWidget extends Common.Object {
  constructor() {
    super();

    this._isEnabled = true;
    this._elements = [];
    this._installDragOnMouseDownBound = this._installDragOnMouseDown.bind(this);
    this._cursor = 'nwse-resize';
  }

  /**
   * @return {boolean}
   */
  isEnabled() {
    return this._isEnabled;
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._isEnabled = enabled;
    this.updateElementCursors();
  }

  /**
   * @return {!Array.<!Element>}
   */
  elements() {
    return this._elements.slice();
  }

  /**
   * @param {!Element} element
   */
  addElement(element) {
    if (this._elements.indexOf(element) !== -1) {
      return;
    }

    this._elements.push(element);
    element.addEventListener('mousedown', this._installDragOnMouseDownBound, false);
    this._updateElementCursor(element);
  }

  /**
   * @param {!Element} element
   */
  removeElement(element) {
    if (this._elements.indexOf(element) === -1) {
      return;
    }

    this._elements.remove(element);
    element.removeEventListener('mousedown', this._installDragOnMouseDownBound, false);
    element.style.removeProperty('cursor');
  }

  updateElementCursors() {
    this._elements.forEach(this._updateElementCursor.bind(this));
  }

  /**
   * @param {!Element} element
   */
  _updateElementCursor(element) {
    if (this._isEnabled) {
      element.style.setProperty('cursor', this.cursor());
    } else {
      element.style.removeProperty('cursor');
    }
  }

  /**
   * @return {string}
   */
  cursor() {
    return this._cursor;
  }

  /**
   * @param {string} cursor
   */
  setCursor(cursor) {
    this._cursor = cursor;
    this.updateElementCursors();
  }

  /**
   * @param {!Event} event
   */
  _installDragOnMouseDown(event) {
    // Only handle drags of the nodes specified.
    if (this._elements.indexOf(event.target) === -1) {
      return false;
    }
    UI.elementDragStart(
        /** @type {!Element} */ (event.target), this._dragStart.bind(this), this._drag.bind(this),
        this._dragEnd.bind(this), this.cursor(), event);
  }

  /**
   * @param {!MouseEvent} event
   * @return {boolean}
   */
  _dragStart(event) {
    if (!this._isEnabled) {
      return false;
    }
    this._startX = event.pageX;
    this._startY = event.pageY;
    this.sendDragStart(this._startX, this._startY);
    return true;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  sendDragStart(x, y) {
    this.dispatchEventToListeners(Events$6.ResizeStart, {startX: x, currentX: x, startY: y, currentY: y});
  }

  /**
   * @param {!MouseEvent} event
   * @return {boolean}
   */
  _drag(event) {
    if (!this._isEnabled) {
      this._dragEnd(event);
      return true;  // Cancel drag.
    }

    this.sendDragMove(this._startX, event.pageX, this._startY, event.pageY, event.shiftKey);
    event.preventDefault();
    return false;  // Continue drag.
  }

  /**
   * @param {number} startX
   * @param {number} currentX
   * @param {number} startY
   * @param {number} currentY
   * @param {boolean} shiftKey
   */
  sendDragMove(startX, currentX, startY, currentY, shiftKey) {
    this.dispatchEventToListeners(
        Events$6.ResizeUpdate,
        {startX: startX, currentX: currentX, startY: startY, currentY: currentY, shiftKey: shiftKey});
  }

  /**
   * @param {!MouseEvent} event
   */
  _dragEnd(event) {
    this.dispatchEventToListeners(Events$6.ResizeEnd);
    delete this._startX;
    delete this._startY;
  }
}

/** @enum {symbol} */
const Events$6 = {
  ResizeStart: Symbol('ResizeStart'),
  ResizeUpdate: Symbol('ResizeUpdate'),
  ResizeEnd: Symbol('ResizeEnd')
};

/**
 * @unrestricted
 */
class SimpleResizerWidget extends ResizerWidget {
  constructor() {
    super();
    this._isVertical = true;
  }

  /**
   * @return {boolean}
   */
  isVertical() {
    return this._isVertical;
  }

  /**
   * Vertical widget resizes height (along y-axis).
   * @param {boolean} vertical
   */
  setVertical(vertical) {
    this._isVertical = vertical;
    this.updateElementCursors();
  }

  /**
   * @override
   * @return {string}
   */
  cursor() {
    return this._isVertical ? 'ns-resize' : 'ew-resize';
  }

  /**
   * @override
   * @param {number} x
   * @param {number} y
   */
  sendDragStart(x, y) {
    const position = this._isVertical ? y : x;
    this.dispatchEventToListeners(Events$6.ResizeStart, {startPosition: position, currentPosition: position});
  }

  /**
   * @override
   * @param {number} startX
   * @param {number} currentX
   * @param {number} startY
   * @param {number} currentY
   * @param {boolean} shiftKey
   */
  sendDragMove(startX, currentX, startY, currentY, shiftKey) {
    if (this._isVertical) {
      this.dispatchEventToListeners(
          Events$6.ResizeUpdate, {startPosition: startY, currentPosition: currentY, shiftKey: shiftKey});
    } else {
      this.dispatchEventToListeners(
          Events$6.ResizeUpdate, {startPosition: startX, currentPosition: currentX, shiftKey: shiftKey});
    }
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ResizerWidget = ResizerWidget;

/** @enum {symbol} */
UI.ResizerWidget.Events = Events$6;

/** @constructor */
UI.SimpleResizerWidget = SimpleResizerWidget;

var ResizerWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ResizerWidget,
  Events: Events$6,
  SimpleResizerWidget: SimpleResizerWidget
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class RootView extends UI.VBox {
  constructor() {
    super();
    this.markAsRoot();
    this.element.classList.add('root-view');
    this.registerRequiredCSS('ui/rootView.css');
    this.element.setAttribute('spellcheck', false);
  }

  /**
   * @param {!Document} document
   */
  attachToDocument(document) {
    document.defaultView.addEventListener('resize', this.doResize.bind(this), false);
    this._window = document.defaultView;
    this.doResize();
    this.show(/** @type {!Element} */ (document.body));
  }

  /**
   * @override
   */
  doResize() {
    if (this._window) {
      const size = this.constraints().minimum;
      const zoom = UI.zoomManager.zoomFactor();
      const right = Math.min(0, this._window.innerWidth - size.width / zoom);
      this.element.style.marginRight = right + 'px';
      const bottom = Math.min(0, this._window.innerHeight - size.height / zoom);
      this.element.style.marginBottom = bottom + 'px';
    }
    super.doResize();
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.RootView = RootView;

var RootView$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': RootView
});

/*
 * Copyright (C) 2006, 2007, 2008 Apple Inc.  All rights reserved.
 * Copyright (C) 2007 Matt Lilek (pewtermoose@gmail.com).
 * Copyright (C) 2009 Joseph Pecoraro
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class SearchableView extends UI.VBox {
  /**
   * @param {!Searchable} searchable
   * @param {string=} settingName
   */
  constructor(searchable, settingName) {
    super(true);
    this.registerRequiredCSS('ui/searchableView.css');
    this.element[_symbol$2] = this;

    this._searchProvider = searchable;
    this._setting = settingName ? Common.settings.createSetting(settingName, {}) : null;
    this._replaceable = false;

    this.contentElement.createChild('slot');
    this._footerElementContainer = this.contentElement.createChild('div', 'search-bar hidden');
    this._footerElementContainer.style.order = 100;
    this._footerElement = this._footerElementContainer.createChild('div', 'toolbar-search');

    const replaceToggleToolbar = new UI.Toolbar('replace-toggle-toolbar', this._footerElement);
    this._replaceToggleButton = new UI.ToolbarToggle(Common.UIString('Replace'), 'mediumicon-replace');
    this._replaceToggleButton.addEventListener(UI.ToolbarButton.Events.Click, this._toggleReplace, this);
    replaceToggleToolbar.appendToolbarItem(this._replaceToggleButton);

    const searchInputElements = this._footerElement.createChild('div', 'toolbar-search-inputs');
    const searchControlElement = searchInputElements.createChild('div', 'toolbar-search-control');

    this._searchInputElement = UI.HistoryInput.create();
    this._searchInputElement.classList.add('search-replace');
    this._searchInputElement.id = 'search-input-field';
    this._searchInputElement.placeholder = Common.UIString('Find');
    searchControlElement.appendChild(this._searchInputElement);

    this._matchesElement = searchControlElement.createChild('label', 'search-results-matches');
    this._matchesElement.setAttribute('for', 'search-input-field');

    const searchNavigationElement = searchControlElement.createChild('div', 'toolbar-search-navigation-controls');

    this._searchNavigationPrevElement =
        searchNavigationElement.createChild('div', 'toolbar-search-navigation toolbar-search-navigation-prev');
    this._searchNavigationPrevElement.addEventListener('click', this._onPrevButtonSearch.bind(this), false);
    this._searchNavigationPrevElement.title = Common.UIString('Search previous');

    this._searchNavigationNextElement =
        searchNavigationElement.createChild('div', 'toolbar-search-navigation toolbar-search-navigation-next');
    this._searchNavigationNextElement.addEventListener('click', this._onNextButtonSearch.bind(this), false);
    this._searchNavigationNextElement.title = Common.UIString('Search next');

    this._searchInputElement.addEventListener('keydown', this._onSearchKeyDown.bind(this), true);
    this._searchInputElement.addEventListener('input', this._onInput.bind(this), false);

    this._replaceInputElement =
        searchInputElements.createChild('input', 'search-replace toolbar-replace-control hidden');
    this._replaceInputElement.addEventListener('keydown', this._onReplaceKeyDown.bind(this), true);
    this._replaceInputElement.placeholder = Common.UIString('Replace');

    this._buttonsContainer = this._footerElement.createChild('div', 'toolbar-search-buttons');
    const firstRowButtons = this._buttonsContainer.createChild('div', 'first-row-buttons');

    const toolbar = new UI.Toolbar('toolbar-search-options', firstRowButtons);

    if (this._searchProvider.supportsCaseSensitiveSearch()) {
      this._caseSensitiveButton = new UI.ToolbarToggle(Common.UIString('Match Case'));
      this._caseSensitiveButton.setText('Aa');
      this._caseSensitiveButton.addEventListener(UI.ToolbarButton.Events.Click, this._toggleCaseSensitiveSearch, this);
      toolbar.appendToolbarItem(this._caseSensitiveButton);
    }

    if (this._searchProvider.supportsRegexSearch()) {
      this._regexButton = new UI.ToolbarToggle(Common.UIString('Use Regular Expression'));
      this._regexButton.setText('.*');
      this._regexButton.addEventListener(UI.ToolbarButton.Events.Click, this._toggleRegexSearch, this);
      toolbar.appendToolbarItem(this._regexButton);
    }

    const cancelButtonElement =
        UI.createTextButton(Common.UIString('Cancel'), this.closeSearch.bind(this), 'search-action-button');
    firstRowButtons.appendChild(cancelButtonElement);

    this._secondRowButtons = this._buttonsContainer.createChild('div', 'second-row-buttons hidden');

    this._replaceButtonElement =
        UI.createTextButton(Common.UIString('Replace'), this._replace.bind(this), 'search-action-button');
    this._replaceButtonElement.disabled = true;
    this._secondRowButtons.appendChild(this._replaceButtonElement);

    this._replaceAllButtonElement =
        UI.createTextButton(Common.UIString('Replace all'), this._replaceAll.bind(this), 'search-action-button');
    this._secondRowButtons.appendChild(this._replaceAllButtonElement);
    this._replaceAllButtonElement.disabled = true;

    this._minimalSearchQuerySize = 3;
    this._loadSetting();
  }

  /**
   * @param {?Element} element
   * @return {?SearchableView}
   */
  static fromElement(element) {
    let view = null;
    while (element && !view) {
      view = element[_symbol$2];
      element = element.parentElementOrShadowHost();
    }
    return view;
  }

  _toggleCaseSensitiveSearch() {
    this._caseSensitiveButton.setToggled(!this._caseSensitiveButton.toggled());
    this._saveSetting();
    this._performSearch(false, true);
  }

  _toggleRegexSearch() {
    this._regexButton.setToggled(!this._regexButton.toggled());
    this._saveSetting();
    this._performSearch(false, true);
  }

  _toggleReplace() {
    this._replaceToggleButton.setToggled(!this._replaceToggleButton.toggled());
    this._updateSecondRowVisibility();
  }

  _saveSetting() {
    if (!this._setting) {
      return;
    }
    const settingValue = this._setting.get() || {};
    settingValue.caseSensitive = this._caseSensitiveButton.toggled();
    settingValue.isRegex = this._regexButton.toggled();
    this._setting.set(settingValue);
  }

  _loadSetting() {
    const settingValue = this._setting ? (this._setting.get() || {}) : {};
    if (this._searchProvider.supportsCaseSensitiveSearch()) {
      this._caseSensitiveButton.setToggled(!!settingValue.caseSensitive);
    }
    if (this._searchProvider.supportsRegexSearch()) {
      this._regexButton.setToggled(!!settingValue.isRegex);
    }
  }

  /**
   * @param {number} minimalSearchQuerySize
   */
  setMinimalSearchQuerySize(minimalSearchQuerySize) {
    this._minimalSearchQuerySize = minimalSearchQuerySize;
  }

  /**
   * @param {string} placeholder
   */
  setPlaceholder(placeholder) {
    this._searchInputElement.placeholder = placeholder;
  }

  /**
   * @param {boolean} replaceable
   */
  setReplaceable(replaceable) {
    this._replaceable = replaceable;
  }

  /**
   * @param {number} matches
   * @suppress {checkTypes}
   */
  updateSearchMatchesCount(matches) {
    if (this._searchProvider.currentSearchMatches === matches) {
      return;
    }
    this._searchProvider.currentSearchMatches = matches;
    this._updateSearchMatchesCountAndCurrentMatchIndex(this._searchProvider.currentQuery ? matches : 0, -1);
  }

  /**
   * @param {number} currentMatchIndex
   * @suppress {checkTypes}
   */
  updateCurrentMatchIndex(currentMatchIndex) {
    this._updateSearchMatchesCountAndCurrentMatchIndex(this._searchProvider.currentSearchMatches, currentMatchIndex);
  }

  /**
   * @return {boolean}
   */
  isSearchVisible() {
    return this._searchIsVisible;
  }

  closeSearch() {
    this.cancelSearch();
    if (this._footerElementContainer.hasFocus()) {
      this.focus();
    }
  }

  _toggleSearchBar(toggled) {
    this._footerElementContainer.classList.toggle('hidden', !toggled);
    this.doResize();
  }

  cancelSearch() {
    if (!this._searchIsVisible) {
      return;
    }
    this.resetSearch();
    delete this._searchIsVisible;
    this._toggleSearchBar(false);
  }

  resetSearch() {
    this._clearSearch();
    this._updateReplaceVisibility();
    this._matchesElement.textContent = '';
  }

  refreshSearch() {
    if (!this._searchIsVisible) {
      return;
    }
    this.resetSearch();
    this._performSearch(false, false);
  }

  /**
   * @return {boolean}
   */
  handleFindNextShortcut() {
    if (!this._searchIsVisible) {
      return false;
    }
    this._searchProvider.jumpToNextSearchResult();
    return true;
  }

  /**
   * @return {boolean}
   */
  handleFindPreviousShortcut() {
    if (!this._searchIsVisible) {
      return false;
    }
    this._searchProvider.jumpToPreviousSearchResult();
    return true;
  }

  /**
   * @return {boolean}
   */
  handleFindShortcut() {
    this.showSearchField();
    return true;
  }

  /**
   * @return {boolean}
   */
  handleCancelSearchShortcut() {
    if (!this._searchIsVisible) {
      return false;
    }
    this.closeSearch();
    return true;
  }

  /**
   * @param {boolean} enabled
   */
  _updateSearchNavigationButtonState(enabled) {
    this._replaceButtonElement.disabled = !enabled;
    this._replaceAllButtonElement.disabled = !enabled;
    this._searchNavigationPrevElement.classList.toggle('enabled', enabled);
    this._searchNavigationNextElement.classList.toggle('enabled', enabled);
  }

  /**
   * @param {number} matches
   * @param {number} currentMatchIndex
   */
  _updateSearchMatchesCountAndCurrentMatchIndex(matches, currentMatchIndex) {
    if (!this._currentQuery) {
      this._matchesElement.textContent = '';
    } else if (matches === 0 || currentMatchIndex >= 0) {
      this._matchesElement.textContent = Common.UIString('%d of %d', currentMatchIndex + 1, matches);
    } else if (matches === 1) {
      this._matchesElement.textContent = Common.UIString('1 match');
    } else {
      this._matchesElement.textContent = Common.UIString('%d matches', matches);
    }
    this._updateSearchNavigationButtonState(matches > 0);
  }

  showSearchField() {
    if (this._searchIsVisible) {
      this.cancelSearch();
    }

    let queryCandidate;
    if (!this._searchInputElement.hasFocus()) {
      const selection = UI.inspectorView.element.window().getSelection();
      if (selection.rangeCount) {
        queryCandidate = selection.toString().replace(/\r?\n.*/, '');
      }
    }

    this._toggleSearchBar(true);
    this._updateReplaceVisibility();
    if (queryCandidate) {
      this._searchInputElement.value = queryCandidate;
    }
    this._performSearch(false, false);
    this._searchInputElement.focus();
    this._searchInputElement.select();
    this._searchIsVisible = true;
  }

  _updateReplaceVisibility() {
    this._replaceToggleButton.setVisible(this._replaceable);
    if (!this._replaceable) {
      this._replaceToggleButton.setToggled(false);
      this._updateSecondRowVisibility();
    }
  }

  /**
   * @param {!Event} event
   */
  _onSearchKeyDown(event) {
    if (isEscKey(event)) {
      this.closeSearch();
      event.consume(true);
      return;
    }
    if (!isEnterKey(event)) {
      return;
    }

    if (!this._currentQuery) {
      this._performSearch(true, true, event.shiftKey);
    } else {
      this._jumpToNextSearchResult(event.shiftKey);
    }
  }

  /**
   * @param {!Event} event
   */
  _onReplaceKeyDown(event) {
    if (isEnterKey(event)) {
      this._replace();
    }
  }

  /**
   * @param {boolean=} isBackwardSearch
   */
  _jumpToNextSearchResult(isBackwardSearch) {
    if (!this._currentQuery) {
      return;
    }

    if (isBackwardSearch) {
      this._searchProvider.jumpToPreviousSearchResult();
    } else {
      this._searchProvider.jumpToNextSearchResult();
    }
  }

  _onNextButtonSearch(event) {
    if (!this._searchNavigationNextElement.classList.contains('enabled')) {
      return;
    }
    this._jumpToNextSearchResult();
    this._searchInputElement.focus();
  }

  _onPrevButtonSearch(event) {
    if (!this._searchNavigationPrevElement.classList.contains('enabled')) {
      return;
    }
    this._jumpToNextSearchResult(true);
    this._searchInputElement.focus();
  }

  _onFindClick(event) {
    if (!this._currentQuery) {
      this._performSearch(true, true);
    } else {
      this._jumpToNextSearchResult();
    }
    this._searchInputElement.focus();
  }

  _onPreviousClick(event) {
    if (!this._currentQuery) {
      this._performSearch(true, true, true);
    } else {
      this._jumpToNextSearchResult(true);
    }
    this._searchInputElement.focus();
  }

  /** @suppress {checkTypes} */
  _clearSearch() {
    delete this._currentQuery;
    if (!!this._searchProvider.currentQuery) {
      delete this._searchProvider.currentQuery;
      this._searchProvider.searchCanceled();
    }
    this._updateSearchMatchesCountAndCurrentMatchIndex(0, -1);
  }

  /**
   * @param {boolean} forceSearch
   * @param {boolean} shouldJump
   * @param {boolean=} jumpBackwards
   * @suppress {checkTypes}
   */
  _performSearch(forceSearch, shouldJump, jumpBackwards) {
    const query = this._searchInputElement.value;
    if (!query || (!forceSearch && query.length < this._minimalSearchQuerySize && !this._currentQuery)) {
      this._clearSearch();
      return;
    }

    this._currentQuery = query;
    this._searchProvider.currentQuery = query;

    const searchConfig = this._currentSearchConfig();
    this._searchProvider.performSearch(searchConfig, shouldJump, jumpBackwards);
  }

  /**
   * @return {!SearchConfig}
   */
  _currentSearchConfig() {
    const query = this._searchInputElement.value;
    const caseSensitive = this._caseSensitiveButton ? this._caseSensitiveButton.toggled() : false;
    const isRegex = this._regexButton ? this._regexButton.toggled() : false;
    return new SearchConfig(query, caseSensitive, isRegex);
  }

  _updateSecondRowVisibility() {
    const secondRowVisible = this._replaceToggleButton.toggled();
    this._footerElementContainer.classList.toggle('replaceable', secondRowVisible);
    this._secondRowButtons.classList.toggle('hidden', !secondRowVisible);
    this._replaceInputElement.classList.toggle('hidden', !secondRowVisible);

    if (secondRowVisible) {
      this._replaceInputElement.focus();
    } else {
      this._searchInputElement.focus();
    }
    this.doResize();
  }

  _replace() {
    const searchConfig = this._currentSearchConfig();
    /** @type {!UI.Replaceable} */ (this._searchProvider)
        .replaceSelectionWith(searchConfig, this._replaceInputElement.value);
    delete this._currentQuery;
    this._performSearch(true, true);
  }

  _replaceAll() {
    const searchConfig = this._currentSearchConfig();
    /** @type {!UI.Replaceable} */ (this._searchProvider).replaceAllWith(searchConfig, this._replaceInputElement.value);
  }

  /**
   * @param {!Event} event
   */
  _onInput(event) {
    if (this._valueChangedTimeoutId) {
      clearTimeout(this._valueChangedTimeoutId);
    }
    const timeout = this._searchInputElement.value.length < 3 ? 200 : 0;
    this._valueChangedTimeoutId = setTimeout(this._onValueChanged.bind(this), timeout);
  }

  _onValueChanged() {
    if (!this._searchIsVisible) {
      return;
    }
    delete this._valueChangedTimeoutId;
    this._performSearch(false, true);
  }
}

const _symbol$2 = Symbol('searchableView');


/**
 * @interface
 */
class Searchable {
  searchCanceled() {
  }

  /**
   * @param {!SearchConfig} searchConfig
   * @param {boolean} shouldJump
   * @param {boolean=} jumpBackwards
   */
  performSearch(searchConfig, shouldJump, jumpBackwards) {
  }

  jumpToNextSearchResult() {
  }

  jumpToPreviousSearchResult() {
  }

  /**
   * @return {boolean}
   */
  supportsCaseSensitiveSearch() {
  }

  /**
   * @return {boolean}
   */
  supportsRegexSearch() {}
}

/**
 * @interface
 */
class Replaceable {
  /**
   * @param {!SearchConfig} searchConfig
   * @param {string} replacement
   */
  replaceSelectionWith(searchConfig, replacement) {
  }

  /**
   * @param {!SearchConfig} searchConfig
   * @param {string} replacement
   */
  replaceAllWith(searchConfig, replacement) {}
}

/**
 * @unrestricted
 */
class SearchConfig {
  /**
   * @param {string} query
   * @param {boolean} caseSensitive
   * @param {boolean} isRegex
   */
  constructor(query, caseSensitive, isRegex) {
    this.query = query;
    this.caseSensitive = caseSensitive;
    this.isRegex = isRegex;
  }

  /**
   * @param {boolean=} global
   * @return {!RegExp}
   */
  toSearchRegex(global) {
    let modifiers = this.caseSensitive ? '' : 'i';
    if (global) {
      modifiers += 'g';
    }
    const query = this.isRegex ? '/' + this.query + '/' : this.query;

    let regex;

    // First try creating regex if user knows the / / hint.
    try {
      if (/^\/.+\/$/.test(query)) {
        regex = new RegExp(query.substring(1, query.length - 1), modifiers);
        regex.__fromRegExpQuery = true;
      }
    } catch (e) {
      // Silent catch.
    }

    // Otherwise just do a plain text search.
    if (!regex) {
      regex = createPlainTextSearchRegex(query, modifiers);
    }

    return regex;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SearchableView = SearchableView;

/**
 * @constructor
 */
UI.SearchableView.SearchConfig = SearchConfig;

/** @interface */
UI.Searchable = Searchable;

/** @interface */
UI.Replaceable = Replaceable;

var SearchableView$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SearchableView,
  _symbol: _symbol$2,
  Searchable: Searchable,
  Replaceable: Replaceable,
  SearchConfig: SearchConfig
});

// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class SegmentedButton extends UI.HBox {
  constructor() {
    super(true);
    /** @type {!Map<string, !Element>} */
    this._buttons = new Map();

    /** @type {?string} */
    this._selected = null;
    this.registerRequiredCSS('ui/segmentedButton.css');
    this.contentElement.classList.add('segmented-button');
  }

  /**
   * @param {string} label
   * @param {string} value
   * @param {string=} tooltip
   */
  addSegment(label, value, tooltip) {
    const button = this.contentElement.createChild('button', 'segmented-button-segment');
    button.textContent = label;
    button.title = tooltip;
    this._buttons.set(value, button);
    button.addEventListener('click', () => this.select(value));
  }

  /**
   * @param {string} value
   */
  select(value) {
    if (this._selected === value) {
      return;
    }
    this._selected = value;
    for (const key of this._buttons.keys()) {
      this._buttons.get(key).classList.toggle('segmented-button-segment-selected', key === this._selected);
    }
  }

  /**
   * @return {?string}
   */
  selected() {
    return this._selected;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SegmentedButton = SegmentedButton;

var SegmentedButton$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SegmentedButton
});

/*
 * Copyright (C) 2014 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
const SettingsUI = {};

/**
 * @param {string} name
 * @param {!Common.Setting} setting
 * @param {boolean=} omitParagraphElement
 * @param {string=} tooltip
 * @return {!Element}
 */
const createSettingCheckbox = function(name, setting, omitParagraphElement, tooltip) {
  const label = UI.CheckboxLabel.create(name);
  if (tooltip) {
    label.title = tooltip;
  }

  const input = label.checkboxElement;
  input.name = name;
  bindCheckbox(input, setting);

  if (omitParagraphElement) {
    return label;
  }

  const p = createElement('p');
  p.appendChild(label);
  return p;
};

/**
 * @param {string} name
 * @param {!Array<!{text: string, value: *, raw: (boolean|undefined)}>} options
 * @param {!Common.Setting} setting
 * @param {string=} subtitle
 * @return {!Element}
 */
const createSettingSelect = function(name, options, setting, subtitle) {
  const settingSelectElement = createElement('p');
  const label = settingSelectElement.createChild('label');
  const select = settingSelectElement.createChild('select', 'chrome-select');
  label.textContent = name;
  if (subtitle) {
    settingSelectElement.classList.add('chrome-select-label');
    label.createChild('p').textContent = subtitle;
  }
  UI.ARIAUtils.bindLabelToControl(label, select);

  for (let i = 0; i < options.length; ++i) {
    // The "raw" flag indicates text is non-i18n-izable.
    const option = options[i];
    const optionName = option.raw ? option.text : Common.UIString(option.text);
    select.add(new Option(optionName, option.value));
  }

  setting.addChangeListener(settingChanged);
  settingChanged();
  select.addEventListener('change', selectChanged, false);
  return settingSelectElement;

  function settingChanged() {
    const newValue = setting.get();
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === newValue) {
        select.selectedIndex = i;
      }
    }
  }

  function selectChanged() {
    // Don't use event.target.value to avoid conversion of the value to string.
    setting.set(options[select.selectedIndex].value);
  }
};

/**
 * @param {!Element} input
 * @param {!Common.Setting} setting
 */
const bindCheckbox = function(input, setting) {
  function settingChanged() {
    if (input.checked !== setting.get()) {
      input.checked = setting.get();
    }
  }
  setting.addChangeListener(settingChanged);
  settingChanged();

  function inputChanged() {
    if (setting.get() !== input.checked) {
      setting.set(input.checked);
    }
  }
  input.addEventListener('change', inputChanged, false);
};

/**
 * @param {string} name
 * @param {!Element} element
 * @return {!Element}
 */
const createCustomSetting = function(name, element) {
  const p = createElement('p');
  const fieldsetElement = p.createChild('fieldset');
  const label = fieldsetElement.createChild('label');
  label.textContent = name;
  UI.ARIAUtils.bindLabelToControl(label, element);
  fieldsetElement.appendChild(element);
  return p;
};

/**
 * @param {!Common.Setting} setting
 * @param {string=} subtitle
 * @return {?Element}
 */
const createControlForSetting = function(setting, subtitle) {
  if (!setting.extension()) {
    return null;
  }
  const descriptor = setting.extension().descriptor();
  const uiTitle = Common.UIString(setting.title() || '');
  switch (descriptor['settingType']) {
    case 'boolean':
      return createSettingCheckbox(uiTitle, setting);
    case 'enum':
      if (Array.isArray(descriptor['options'])) {
        return createSettingSelect(uiTitle, descriptor['options'], setting, subtitle);
      }
      console.error('Enum setting defined without options');
      return null;
    default:
      console.error('Invalid setting type: ' + descriptor['settingType']);
      return null;
  }
};

/**
 * @interface
 */
class SettingUI {
  /**
   * @return {?Element}
   */
  settingElement() {}
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

UI.SettingsUI = SettingsUI;

/**
 * @interface
 */
UI.SettingUI = SettingUI;

/**
 * @param {string} name
 * @param {!Common.Setting} setting
 * @param {boolean=} omitParagraphElement
 * @param {string=} tooltip
 * @return {!Element}
 */
UI.SettingsUI.createSettingCheckbox = createSettingCheckbox;

/**
 * @param {string} name
 * @param {!Array<!{text: string, value: *, raw: (boolean|undefined)}>} options
 * @param {!Common.Setting} setting
 * @param {string=} subtitle
 * @return {!Element}
 */
UI.SettingsUI.createSettingSelect = createSettingSelect;

/**
 * @param {!Element} input
 * @param {!Common.Setting} setting
 */
UI.SettingsUI.bindCheckbox = bindCheckbox;

/**
 * @param {string} name
 * @param {!Element} element
 * @return {!Element}
 */
UI.SettingsUI.createCustomSetting = createCustomSetting;

/**
 * @param {!Common.Setting} setting
 * @param {string=} subtitle
 * @return {?Element}
 */
UI.SettingsUI.createControlForSetting = createControlForSetting;

var SettingsUI$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SettingsUI,
  createSettingCheckbox: createSettingCheckbox,
  createSettingSelect: createSettingSelect,
  bindCheckbox: bindCheckbox,
  createCustomSetting: createCustomSetting,
  createControlForSetting: createControlForSetting,
  SettingUI: SettingUI
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ShortcutRegistry {
  /**
   * @param {!UI.ActionRegistry} actionRegistry
   * @param {!Document} document
   */
  constructor(actionRegistry, document) {
    this._actionRegistry = actionRegistry;
    /** @type {!Platform.Multimap.<string, string>} */
    this._defaultKeyToActions = new Platform.Multimap();
    /** @type {!Platform.Multimap.<string, !UI.KeyboardShortcut.Descriptor>} */
    this._defaultActionToShortcut = new Platform.Multimap();
    this._registerBindings(document);
  }

  /**
   * @param {number} key
   * @return {!Array.<!UI.Action>}
   */
  _applicableActions(key) {
    return this._actionRegistry.applicableActions(this._defaultActionsForKey(key).valuesArray(), UI.context);
  }

  /**
   * @param {number} key
   * @return {!Set.<string>}
   */
  _defaultActionsForKey(key) {
    return this._defaultKeyToActions.get(String(key));
  }

  /**
   * @return {!Array<number>}
   */
  globalShortcutKeys() {
    const keys = [];
    for (const key of this._defaultKeyToActions.keysArray()) {
      const actions = this._defaultKeyToActions.get(key).valuesArray();
      const applicableActions = this._actionRegistry.applicableActions(actions, new UI.Context());
      if (applicableActions.length) {
        keys.push(Number(key));
      }
    }
    return keys;
  }

  /**
   * @param {string} actionId
   * @return {!Array.<!UI.KeyboardShortcut.Descriptor>}
   */
  shortcutDescriptorsForAction(actionId) {
    return this._defaultActionToShortcut.get(actionId).valuesArray();
  }

  /**
   * @param {!Array.<string>} actionIds
   * @return {!Array.<number>}
   */
  keysForActions(actionIds) {
    const result = [];
    for (let i = 0; i < actionIds.length; ++i) {
      const descriptors = this.shortcutDescriptorsForAction(actionIds[i]);
      for (let j = 0; j < descriptors.length; ++j) {
        result.push(descriptors[j].key);
      }
    }
    return result;
  }

  /**
   * @param {string} actionId
   * @return {string|undefined}
   */
  shortcutTitleForAction(actionId) {
    const descriptors = this.shortcutDescriptorsForAction(actionId);
    if (descriptors.length) {
      return descriptors[0].name;
    }
  }

  /**
   * @param {!KeyboardEvent} event
   */
  handleShortcut(event) {
    this.handleKey(UI.KeyboardShortcut.makeKeyFromEvent(event), event.key, event);
  }

  /**
   * @param {!KeyboardEvent} event
   * @param {string} actionId
   * @return {boolean}
   */
  eventMatchesAction(event, actionId) {
    console.assert(this._defaultActionToShortcut.has(actionId), 'Unknown action ' + actionId);
    const key = UI.KeyboardShortcut.makeKeyFromEvent(event);
    return this._defaultActionToShortcut.get(actionId).valuesArray().some(descriptor => descriptor.key === key);
  }

  /**
   * @param {!Element} element
   * @param {string} actionId
   * @param {function():boolean} listener
   * @param {boolean=} capture
   */
  addShortcutListener(element, actionId, listener, capture) {
    console.assert(this._defaultActionToShortcut.has(actionId), 'Unknown action ' + actionId);
    element.addEventListener('keydown', event => {
      if (!this.eventMatchesAction(/** @type {!KeyboardEvent} */ (event), actionId) || !listener.call(null)) {
        return;
      }
      event.consume(true);
    }, capture);
  }

  /**
   * @param {number} key
   * @param {string} domKey
   * @param {!KeyboardEvent=} event
   */
  async handleKey(key, domKey, event) {
    const keyModifiers = key >> 8;
    const actions = this._applicableActions(key);
    if (!actions.length || isPossiblyInputKey()) {
      return;
    }
    if (event) {
      event.consume(true);
    }
    if (UI.Dialog.hasInstance()) {
      return;
    }
    for (const action of actions) {
      if (await action.execute()) {
        return;
      }
    }

    /**
     * @return {boolean}
     */
    function isPossiblyInputKey() {
      if (!event || !UI.isEditing() || /^F\d+|Control|Shift|Alt|Meta|Escape|Win|U\+001B$/.test(domKey)) {
        return false;
      }

      if (!keyModifiers) {
        return true;
      }

      const modifiers = UI.KeyboardShortcut.Modifiers;
      // Undo/Redo will also cause input, so textual undo should take precedence over DevTools undo when editing.
      if (Host.isMac()) {
        if (UI.KeyboardShortcut.makeKey('z', modifiers.Meta) === key) {
          return true;
        }
        if (UI.KeyboardShortcut.makeKey('z', modifiers.Meta | modifiers.Shift) === key) {
          return true;
        }
      } else {
        if (UI.KeyboardShortcut.makeKey('z', modifiers.Ctrl) === key) {
          return true;
        }
        if (UI.KeyboardShortcut.makeKey('y', modifiers.Ctrl) === key) {
          return true;
        }
        if (!Host.isWin() && UI.KeyboardShortcut.makeKey('z', modifiers.Ctrl | modifiers.Shift) === key) {
          return true;
        }
      }

      if ((keyModifiers & (modifiers.Ctrl | modifiers.Alt)) === (modifiers.Ctrl | modifiers.Alt)) {
        return Host.isWin();
      }

      return !hasModifier(modifiers.Ctrl) && !hasModifier(modifiers.Alt) && !hasModifier(modifiers.Meta);
    }

    /**
     * @param {number} mod
     * @return {boolean}
     */
    function hasModifier(mod) {
      return !!(keyModifiers & mod);
    }
  }

  /**
   * @param {string} actionId
   * @param {string} shortcut
   */
  registerShortcut(actionId, shortcut) {
    const descriptor = UI.KeyboardShortcut.makeDescriptorFromBindingShortcut(shortcut);
    if (!descriptor) {
      return;
    }
    this._defaultActionToShortcut.set(actionId, descriptor);
    this._defaultKeyToActions.set(String(descriptor.key), actionId);
  }

  /**
   * @param {!Document} document
   */
  _registerBindings(document) {
    const extensions = self.runtime.extensions('action');
    extensions.forEach(registerExtension, this);

    /**
     * @param {!Root.Runtime.Extension} extension
     * @this {ShortcutRegistry}
     */
    function registerExtension(extension) {
      const descriptor = extension.descriptor();
      const bindings = descriptor['bindings'];
      for (let i = 0; bindings && i < bindings.length; ++i) {
        if (!platformMatches(bindings[i].platform)) {
          continue;
        }
        const shortcuts = bindings[i]['shortcut'].split(/\s+/);
        shortcuts.forEach(this.registerShortcut.bind(this, descriptor['actionId']));
      }
    }

    /**
     * @param {string=} platformsString
     * @return {boolean}
     */
    function platformMatches(platformsString) {
      if (!platformsString) {
        return true;
      }
      const platforms = platformsString.split(',');
      let isMatch = false;
      const currentPlatform = Host.platform();
      for (let i = 0; !isMatch && i < platforms.length; ++i) {
        isMatch = platforms[i] === currentPlatform;
      }
      return isMatch;
    }
  }
}

/**
 * @unrestricted
 */
class ForwardedShortcut {}

ForwardedShortcut.instance = new ForwardedShortcut();

/** @type {!ShortcutRegistry} */
UI.shortcutRegistry;

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ShortcutRegistry = ShortcutRegistry;

/**
 * @unrestricted
 */
UI.ShortcutRegistry.ForwardedShortcut = ForwardedShortcut;

var ShortcutRegistry$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ShortcutRegistry,
  ForwardedShortcut: ForwardedShortcut
});

/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class ShortcutsScreen {
  constructor() {
    /** @type {!Object.<string, !ShortcutsSection>} */
    this._sections = {};
  }

  static registerShortcuts() {
    // Elements panel
    const elementsSection = UI.shortcutsScreen.section(Common.UIString('Elements Panel'));

    const navigate = ElementsPanelShortcuts.NavigateUp.concat(ElementsPanelShortcuts.NavigateDown);
    elementsSection.addRelatedKeys(navigate, Common.UIString('Navigate elements'));

    const expandCollapse = ElementsPanelShortcuts.Expand.concat(ElementsPanelShortcuts.Collapse);
    elementsSection.addRelatedKeys(expandCollapse, Common.UIString('Expand/collapse'));

    elementsSection.addAlternateKeys(ElementsPanelShortcuts.EditAttribute, Common.UIString('Edit attribute'));
    elementsSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('elements.hide-element'), Common.UIString('Hide element'));
    elementsSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('elements.edit-as-html'),
        Common.UIString('Toggle edit as HTML'));

    // Styles pane
    const stylesPaneSection = UI.shortcutsScreen.section(Common.UIString('Styles Pane'));

    const nextPreviousProperty = ElementsPanelShortcuts.NextProperty.concat(ElementsPanelShortcuts.PreviousProperty);
    stylesPaneSection.addRelatedKeys(nextPreviousProperty, Common.UIString('Next/previous property'));

    stylesPaneSection.addRelatedKeys(ElementsPanelShortcuts.IncrementValue, Common.UIString('Increment value'));
    stylesPaneSection.addRelatedKeys(ElementsPanelShortcuts.DecrementValue, Common.UIString('Decrement value'));

    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.IncrementBy10, Common.UIString('Increment by %f', 10));
    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.DecrementBy10, Common.UIString('Decrement by %f', 10));

    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.IncrementBy100, Common.UIString('Increment by %f', 100));
    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.DecrementBy100, Common.UIString('Decrement by %f', 100));

    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.IncrementBy01, Common.UIString('Increment by %f', 0.1));
    stylesPaneSection.addAlternateKeys(ElementsPanelShortcuts.DecrementBy01, Common.UIString('Decrement by %f', 0.1));

    // Console
    const consoleSection = UI.shortcutsScreen.section(Common.UIString('Console'));

    consoleSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('console.clear'), Common.UIString('Clear console'));
    consoleSection.addRelatedKeys(ConsolePanelShortcuts.AcceptSuggestion, Common.UIString('Accept suggestion'));
    consoleSection.addAlternateKeys(ConsolePanelShortcuts.ClearConsolePrompt, Common.UIString('Clear console prompt'));
    consoleSection.addRelatedKeys(ConsolePanelShortcuts.NextPreviousLine, Common.UIString('Next/previous line'));

    if (Host.isMac()) {
      consoleSection.addRelatedKeys(
          ConsolePanelShortcuts.NextPreviousCommand, Common.UIString('Next/previous command'));
    }

    consoleSection.addKey(ConsolePanelShortcuts.ExecuteCommand, Common.UIString('Execute command'));

    // Debugger
    const debuggerSection = UI.shortcutsScreen.section(Common.UIString('Debugger'));

    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.toggle-pause'), Common.UIString('Pause/ Continue'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.step-over'), Common.UIString('Step over'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.step-into'), Common.UIString('Step into'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.step-out'), Common.UIString('Step out'));

    const nextAndPrevFrameKeys =
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.next-call-frame')
            .concat(UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.previous-call-frame'));
    debuggerSection.addRelatedKeys(nextAndPrevFrameKeys, Common.UIString('Next/previous call frame'));

    debuggerSection.addAlternateKeys(
        SourcesPanelShortcuts.EvaluateSelectionInConsole, Common.UIString('Evaluate selection in console'));
    debuggerSection.addAlternateKeys(
        SourcesPanelShortcuts.AddSelectionToWatch, Common.UIString('Add selection to watch'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.toggle-breakpoint'),
        Common.UIString('Toggle breakpoint'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.toggle-breakpoint-enabled'),
        Common.UIString('Toggle breakpoint enabled'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.toggle-breakpoints-active'),
        Common.UIString('Toggle all breakpoints'));
    debuggerSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('debugger.breakpoint-input-window'),
        ls`Open breakpoint editor`);

    // Editing
    const editingSection = UI.shortcutsScreen.section(Common.UIString('Text Editor'));

    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.go-to-member'), Common.UIString('Go to member'));
    editingSection.addAlternateKeys(SourcesPanelShortcuts.ToggleAutocompletion, Common.UIString('Autocompletion'));
    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.go-to-line'), Common.UIString('Go to line'));
    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.jump-to-previous-location'),
        Common.UIString('Jump to previous editing location'));
    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.jump-to-next-location'),
        Common.UIString('Jump to next editing location'));
    editingSection.addAlternateKeys(SourcesPanelShortcuts.ToggleComment, Common.UIString('Toggle comment'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.IncreaseCSSUnitByOne, Common.UIString('Increment CSS unit by 1'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.DecreaseCSSUnitByOne, Common.UIString('Decrement CSS unit by 1'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.IncreaseCSSUnitByTen, Common.UIString('Increment CSS unit by 10'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.DecreaseCSSUnitByTen, Common.UIString('Decrement CSS unit by 10'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.SelectNextOccurrence, Common.UIString('Select next occurrence'));
    editingSection.addAlternateKeys(SourcesPanelShortcuts.SoftUndo, Common.UIString('Soft undo'));
    editingSection.addAlternateKeys(
        SourcesPanelShortcuts.GotoMatchingBracket, Common.UIString('Go to matching bracket'));
    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.close-editor-tab'),
        Common.UIString('Close editor tab'));
    editingSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('sources.switch-file'),
        Common.UIString('Switch between files with the same name and different extensions.'));

    // Performance panel
    const performanceSection = UI.shortcutsScreen.section(Common.UIString('Performance Panel'));

    performanceSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.toggle-recording'),
        Common.UIString('Start/stop recording'));
    performanceSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.record-reload'),
        Common.UIString('Record page reload'));
    performanceSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.save-to-file'), Common.UIString('Save profile'));
    performanceSection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.load-from-file'), Common.UIString('Load profile'));
    performanceSection.addRelatedKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.jump-to-previous-frame')
            .concat(UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.jump-to-next-frame')),
        Common.UIString('Jump to previous/next frame'));
    performanceSection.addRelatedKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.show-history'),
        Common.UIString('Pick a recording from history'));
    performanceSection.addRelatedKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.previous-recording')
            .concat(UI.shortcutRegistry.shortcutDescriptorsForAction('timeline.next-recording')),
        Common.UIString('Show previous/next recording'));

    // Memory panel
    const memorySection = UI.shortcutsScreen.section(Common.UIString('Memory Panel'));

    memorySection.addAlternateKeys(
        UI.shortcutRegistry.shortcutDescriptorsForAction('profiler.heap-toggle-recording'),
        Common.UIString('Start/stop recording'));

    // Layers panel
    const layersSection = UI.shortcutsScreen.section(Common.UIString('Layers Panel'));

    layersSection.addAlternateKeys(LayersPanelShortcuts.ResetView, Common.UIString('Reset view'));
    layersSection.addAlternateKeys(LayersPanelShortcuts.PanMode, Common.UIString('Switch to pan mode'));
    layersSection.addAlternateKeys(LayersPanelShortcuts.RotateMode, Common.UIString('Switch to rotate mode'));
    layersSection.addAlternateKeys(
        LayersPanelShortcuts.TogglePanRotate, Common.UIString('Temporarily toggle pan/rotate mode while held'));
    layersSection.addAlternateKeys(LayersPanelShortcuts.ZoomIn, Common.UIString('Zoom in'));
    layersSection.addAlternateKeys(LayersPanelShortcuts.ZoomOut, Common.UIString('Zoom out'));
    layersSection.addRelatedKeys(
        LayersPanelShortcuts.Up.concat(LayersPanelShortcuts.Down), Common.UIString('Pan or rotate up/down'));
    layersSection.addRelatedKeys(
        LayersPanelShortcuts.Left.concat(LayersPanelShortcuts.Right), Common.UIString('Pan or rotate left/right'));
  }

  /**
   * @param {string} name
   * @return {!ShortcutsSection}
   */
  section(name) {
    let section = this._sections[name];
    if (!section) {
      this._sections[name] = section = new ShortcutsSection(name);
    }
    return section;
  }

  /**
   * @return {!UI.Widget}
   */
  createShortcutsTabView() {
    const orderedSections = [];
    for (const section in this._sections) {
      orderedSections.push(this._sections[section]);
    }
    function compareSections(a, b) {
      return a.order - b.order;
    }
    orderedSections.sort(compareSections);

    const widget = new UI.Widget();

    widget.element.className = 'settings-tab-container';  // Override
    widget.element.createChild('header').createChild('h1').createTextChild(ls`Shortcuts`);
    const scrollPane = widget.element.createChild('div', 'settings-container-wrapper');
    const container = scrollPane.createChild('div');
    container.className = 'settings-content settings-container';
    for (let i = 0; i < orderedSections.length; ++i) {
      orderedSections[i].renderSection(container);
    }

    const note = scrollPane.createChild('p', 'settings-footnote');
    note.appendChild(UI.createDocumentationLink(
        'iterate/inspect-styles/shortcuts', Common.UIString('Full list of DevTools keyboard shortcuts and gestures')));

    return widget;
  }
}

/**
 * We cannot initialize it here as localized strings are not loaded yet.
 * @type {!ShortcutsScreen}
 */
UI.shortcutsScreen;

/**
 * @unrestricted
 */
class ShortcutsSection {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    this._lines = /** @type {!Array.<!{key: !Node, text: string}>} */ ([]);
    this.order = ++ShortcutsSection._sequenceNumber;
  }

  /**
   * @param {!UI.KeyboardShortcut.Descriptor} key
   * @param {string} description
   */
  addKey(key, description) {
    this._addLine(this._renderKey(key), description);
  }

  /**
   * @param {!Array.<!UI.KeyboardShortcut.Descriptor>} keys
   * @param {string} description
   */
  addRelatedKeys(keys, description) {
    this._addLine(this._renderSequence(keys, '/'), description);
  }

  /**
   * @param {!Array.<!UI.KeyboardShortcut.Descriptor>} keys
   * @param {string} description
   */
  addAlternateKeys(keys, description) {
    this._addLine(this._renderSequence(keys, Common.UIString('or')), description);
  }

  /**
   * @param {!Node} keyElement
   * @param {string} description
   */
  _addLine(keyElement, description) {
    this._lines.push({key: keyElement, text: description});
  }

  /**
   * @param {!Element} container
   */
  renderSection(container) {
    const parent = container.createChild('div', 'settings-block');

    const headLine = parent.createChild('div', 'settings-line');
    headLine.createChild('div', 'settings-key-cell');
    headLine.createChild('div', 'settings-section-title settings-cell').textContent = this.name;
    UI.ARIAUtils.markAsHeading(headLine, /* level */ 2);

    for (let i = 0; i < this._lines.length; ++i) {
      const line = parent.createChild('div', 'settings-line');
      const keyCell = line.createChild('div', 'settings-key-cell');
      keyCell.appendChild(this._lines[i].key);
      keyCell.appendChild(this._createSpan('settings-key-delimiter', ':'));
      line.createChild('div', 'settings-cell').textContent = this._lines[i].text;
    }
  }

  /**
   * @param {!Array.<!UI.KeyboardShortcut.Descriptor>} sequence
   * @param {string} delimiter
   * @return {!Node}
   */
  _renderSequence(sequence, delimiter) {
    const delimiterSpan = this._createSpan('settings-key-delimiter', delimiter);
    return this._joinNodes(sequence.map(this._renderKey.bind(this)), delimiterSpan);
  }

  /**
   * @param {!UI.KeyboardShortcut.Descriptor} key
   * @return {!Node}
   */
  _renderKey(key) {
    const keyName = key.name;
    const plus = this._createSpan('settings-combine-keys', '+');
    return this._joinNodes(keyName.split(' + ').map(this._createSpan.bind(this, 'settings-key')), plus);
  }

  /**
   * @param {string} className
   * @param {string} textContent
   * @return {!Element}
   */
  _createSpan(className, textContent) {
    const node = createElement('span');
    node.className = className;
    node.textContent = textContent;
    return node;
  }

  /**
   * @param {!Array.<!Element>} nodes
   * @param {!Element} delimiter
   * @return {!Node}
   */
  _joinNodes(nodes, delimiter) {
    const result = createDocumentFragment();
    for (let i = 0; i < nodes.length; ++i) {
      if (i > 0) {
        result.appendChild(delimiter.cloneNode(true));
      }
      result.appendChild(nodes[i]);
    }
    return result;
  }
}

ShortcutsSection._sequenceNumber = 0;


const ElementsPanelShortcuts = {
  NavigateUp: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up)],

  NavigateDown: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down)],

  Expand: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Right)],

  Collapse: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Left)],

  EditAttribute: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Enter)],

  NextProperty: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Tab)],

  PreviousProperty:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Tab, UI.KeyboardShortcut.Modifiers.Shift)],

  IncrementValue: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up)],

  DecrementValue: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down)],

  IncrementBy10: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageUp),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up, UI.KeyboardShortcut.Modifiers.Shift)
  ],

  DecrementBy10: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageDown),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down, UI.KeyboardShortcut.Modifiers.Shift)
  ],

  IncrementBy100:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageUp, UI.KeyboardShortcut.Modifiers.Shift)],

  DecrementBy100:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageDown, UI.KeyboardShortcut.Modifiers.Shift)],

  IncrementBy01: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up, UI.KeyboardShortcut.Modifiers.Alt)],

  DecrementBy01: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down, UI.KeyboardShortcut.Modifiers.Alt)]
};

const ConsolePanelShortcuts = {
  AcceptSuggestion: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Tab),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Right)
  ],

  ClearConsolePrompt: [UI.KeyboardShortcut.makeDescriptor('u', UI.KeyboardShortcut.Modifiers.Ctrl)],

  ExecuteCommand: UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Enter),

  NextPreviousLine: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up)
  ],

  NextPreviousCommand: [
    UI.KeyboardShortcut.makeDescriptor('N', UI.KeyboardShortcut.Modifiers.Alt),
    UI.KeyboardShortcut.makeDescriptor('P', UI.KeyboardShortcut.Modifiers.Alt)
  ],
};

const SourcesPanelShortcuts = {
  SelectNextOccurrence: [UI.KeyboardShortcut.makeDescriptor('d', UI.KeyboardShortcut.Modifiers.CtrlOrMeta)],

  SoftUndo: [UI.KeyboardShortcut.makeDescriptor('u', UI.KeyboardShortcut.Modifiers.CtrlOrMeta)],

  GotoMatchingBracket: [UI.KeyboardShortcut.makeDescriptor('m', UI.KeyboardShortcut.Modifiers.Ctrl)],

  ToggleAutocompletion:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Space, UI.KeyboardShortcut.Modifiers.Ctrl)],

  IncreaseCSSUnitByOne:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up, UI.KeyboardShortcut.Modifiers.Alt)],

  DecreaseCSSUnitByOne:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down, UI.KeyboardShortcut.Modifiers.Alt)],

  IncreaseCSSUnitByTen:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageUp, UI.KeyboardShortcut.Modifiers.Alt)],

  DecreaseCSSUnitByTen:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.PageDown, UI.KeyboardShortcut.Modifiers.Alt)],
  EvaluateSelectionInConsole: [UI.KeyboardShortcut.makeDescriptor(
      'e', UI.KeyboardShortcut.Modifiers.Shift | UI.KeyboardShortcut.Modifiers.Ctrl)],

  AddSelectionToWatch: [UI.KeyboardShortcut.makeDescriptor(
      'a', UI.KeyboardShortcut.Modifiers.Shift | UI.KeyboardShortcut.Modifiers.Ctrl)],

  ToggleComment:
      [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Slash, UI.KeyboardShortcut.Modifiers.CtrlOrMeta)],
};

const LayersPanelShortcuts = {
  ResetView: [UI.KeyboardShortcut.makeDescriptor('0')],

  PanMode: [UI.KeyboardShortcut.makeDescriptor('x')],

  RotateMode: [UI.KeyboardShortcut.makeDescriptor('v')],

  TogglePanRotate: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Shift)],

  ZoomIn: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Plus, UI.KeyboardShortcut.Modifiers.Shift),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.NumpadPlus)
  ],

  ZoomOut: [
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Minus, UI.KeyboardShortcut.Modifiers.Shift),
    UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.NumpadMinus)
  ],

  Up: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Up), UI.KeyboardShortcut.makeDescriptor('w')],

  Down: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Down), UI.KeyboardShortcut.makeDescriptor('s')],

  Left: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Left), UI.KeyboardShortcut.makeDescriptor('a')],

  Right: [UI.KeyboardShortcut.makeDescriptor(UI.KeyboardShortcut.Keys.Right), UI.KeyboardShortcut.makeDescriptor('d')]
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ShortcutsScreen = ShortcutsScreen;

/** @constructor */
UI.ShortcutsSection = ShortcutsSection;

UI.ShortcutsScreen.ElementsPanelShortcuts = ElementsPanelShortcuts;
UI.ShortcutsScreen.ConsolePanelShortcuts = ConsolePanelShortcuts;
UI.ShortcutsScreen.SourcesPanelShortcuts = SourcesPanelShortcuts;
UI.ShortcutsScreen.LayersPanelShortcuts = LayersPanelShortcuts;

var ShortcutsScreen$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ShortcutsScreen,
  ShortcutsSection: ShortcutsSection,
  ElementsPanelShortcuts: ElementsPanelShortcuts,
  ConsolePanelShortcuts: ConsolePanelShortcuts,
  SourcesPanelShortcuts: SourcesPanelShortcuts,
  LayersPanelShortcuts: LayersPanelShortcuts
});

/*
 * Copyright (C) 2011 Google Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class SoftContextMenu {
  /**
   * @param {!Array.<!InspectorFrontendHostAPI.ContextMenuDescriptor>} items
   * @param {function(string)} itemSelectedCallback
   * @param {!SoftContextMenu=} parentMenu
   */
  constructor(items, itemSelectedCallback, parentMenu) {
    this._items = items;
    this._itemSelectedCallback = itemSelectedCallback;
    this._parentMenu = parentMenu;
    /** @type {?Element} */
    this._highlightedMenuItemElement = null;
  }

  /**
   * @param {!Document} document
   * @param {!AnchorBox} anchorBox
   */
  show(document, anchorBox) {
    if (!this._items.length) {
      return;
    }

    this._document = document;

    this._glassPane = new UI.GlassPane();
    this._glassPane.setPointerEventsBehavior(
        this._parentMenu ? UI.GlassPane.PointerEventsBehavior.PierceGlassPane :
                           UI.GlassPane.PointerEventsBehavior.BlockedByGlassPane);
    this._glassPane.registerRequiredCSS('ui/softContextMenu.css');
    this._glassPane.setContentAnchorBox(anchorBox);
    this._glassPane.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
    this._glassPane.setMarginBehavior(UI.GlassPane.MarginBehavior.NoMargin);
    this._glassPane.setAnchorBehavior(
        this._parentMenu ? UI.GlassPane.AnchorBehavior.PreferRight : UI.GlassPane.AnchorBehavior.PreferBottom);

    this._contextMenuElement = this._glassPane.contentElement.createChild('div', 'soft-context-menu');
    this._contextMenuElement.tabIndex = -1;
    UI.ARIAUtils.markAsMenu(this._contextMenuElement);
    this._contextMenuElement.addEventListener('mouseup', e => e.consume(), false);
    this._contextMenuElement.addEventListener('keydown', this._menuKeyDown.bind(this), false);

    for (let i = 0; i < this._items.length; ++i) {
      this._contextMenuElement.appendChild(this._createMenuItem(this._items[i]));
    }

    this._glassPane.show(document);
    this._focusRestorer = new UI.ElementFocusRestorer(this._contextMenuElement);

    if (!this._parentMenu) {
      this._hideOnUserGesture = event => {
        // If a user clicks on any submenu, prevent the menu system from closing.
        let subMenu = this._subMenu;
        while (subMenu) {
          if (subMenu._contextMenuElement === event.path[0]) {
            return;
          }
          subMenu = subMenu._subMenu;
        }

        this.discard();
        event.consume(true);
      };
      this._document.body.addEventListener('mousedown', this._hideOnUserGesture, false);
      this._document.defaultView.addEventListener('resize', this._hideOnUserGesture, false);
    }
  }

  discard() {
    if (this._subMenu) {
      this._subMenu.discard();
    }
    if (this._focusRestorer) {
      this._focusRestorer.restore();
    }
    if (this._glassPane) {
      this._glassPane.hide();
      delete this._glassPane;
      if (this._hideOnUserGesture) {
        this._document.body.removeEventListener('mousedown', this._hideOnUserGesture, false);
        this._document.defaultView.removeEventListener('resize', this._hideOnUserGesture, false);
        delete this._hideOnUserGesture;
      }
    }
    if (this._parentMenu) {
      delete this._parentMenu._subMenu;
    }
  }

  _createMenuItem(item) {
    if (item.type === 'separator') {
      return this._createSeparator();
    }

    if (item.type === 'subMenu') {
      return this._createSubMenu(item);
    }

    const menuItemElement = createElementWithClass('div', 'soft-context-menu-item');
    menuItemElement.tabIndex = -1;
    UI.ARIAUtils.markAsMenuItem(menuItemElement);
    const checkMarkElement = UI.Icon.create('smallicon-checkmark', 'checkmark');
    menuItemElement.appendChild(checkMarkElement);
    if (!item.checked) {
      checkMarkElement.style.opacity = '0';
    }

    if (item.element) {
      const wrapper = menuItemElement.createChild('div', 'soft-context-menu-custom-item');
      wrapper.appendChild(item.element);
      menuItemElement._customElement = item.element;
      return menuItemElement;
    }

    if (!item.enabled) {
      menuItemElement.classList.add('soft-context-menu-disabled');
    }
    menuItemElement.createTextChild(item.label);
    menuItemElement.createChild('span', 'soft-context-menu-shortcut').textContent = item.shortcut;

    menuItemElement.addEventListener('mousedown', this._menuItemMouseDown.bind(this), false);
    menuItemElement.addEventListener('mouseup', this._menuItemMouseUp.bind(this), false);

    // Manually manage hover highlight since :hover does not work in case of click-and-hold menu invocation.
    menuItemElement.addEventListener('mouseover', this._menuItemMouseOver.bind(this), false);
    menuItemElement.addEventListener('mouseleave', this._menuItemMouseLeave.bind(this), false);

    menuItemElement._actionId = item.id;

    let accessibleName = item.label;

    if (item.type === 'checkbox') {
      const checkedState = item.checked ? ls`checked` : ls`unchecked`;
      if (item.shortcut) {
        accessibleName = ls`${item.label}, ${item.shortcut}, ${checkedState}`;
      } else {
        accessibleName = ls`${item.label}, ${checkedState}`;
      }
    } else if (item.shortcut) {
      accessibleName = ls`${item.label}, ${item.shortcut}`;
    }
    UI.ARIAUtils.setAccessibleName(menuItemElement, accessibleName);

    return menuItemElement;
  }

  _createSubMenu(item) {
    const menuItemElement = createElementWithClass('div', 'soft-context-menu-item');
    menuItemElement._subItems = item.subItems;
    menuItemElement.tabIndex = -1;
    UI.ARIAUtils.markAsMenuItemSubMenu(menuItemElement);

    // Occupy the same space on the left in all items.
    const checkMarkElement = UI.Icon.create('smallicon-checkmark', 'soft-context-menu-item-checkmark');
    checkMarkElement.classList.add('checkmark');
    menuItemElement.appendChild(checkMarkElement);
    checkMarkElement.style.opacity = '0';

    menuItemElement.createTextChild(item.label);

    if (Host.isMac() && !UI.themeSupport.hasTheme()) {
      const subMenuArrowElement = menuItemElement.createChild('span', 'soft-context-menu-item-submenu-arrow');
      subMenuArrowElement.textContent = '\u25B6';  // BLACK RIGHT-POINTING TRIANGLE
    } else {
      const subMenuArrowElement = UI.Icon.create('smallicon-triangle-right', 'soft-context-menu-item-submenu-arrow');
      menuItemElement.appendChild(subMenuArrowElement);
    }

    menuItemElement.addEventListener('mousedown', this._menuItemMouseDown.bind(this), false);
    menuItemElement.addEventListener('mouseup', this._menuItemMouseUp.bind(this), false);

    // Manually manage hover highlight since :hover does not work in case of click-and-hold menu invocation.
    menuItemElement.addEventListener('mouseover', this._menuItemMouseOver.bind(this), false);
    menuItemElement.addEventListener('mouseleave', this._menuItemMouseLeave.bind(this), false);

    return menuItemElement;
  }

  _createSeparator() {
    const separatorElement = createElementWithClass('div', 'soft-context-menu-separator');
    separatorElement._isSeparator = true;
    separatorElement.createChild('div', 'separator-line');
    return separatorElement;
  }

  _menuItemMouseDown(event) {
    // Do not let separator's mouse down hit menu's handler - we need to receive mouse up!
    event.consume(true);
  }

  _menuItemMouseUp(event) {
    this._triggerAction(event.target, event);
    event.consume();
  }

  /**
   * @return {!SoftContextMenu}
   */
  _root() {
    let root = this;
    while (root._parentMenu) {
      root = root._parentMenu;
    }
    return root;
  }

  _triggerAction(menuItemElement, event) {
    if (!menuItemElement._subItems) {
      this._root().discard();
      event.consume(true);
      if (typeof menuItemElement._actionId !== 'undefined') {
        this._itemSelectedCallback(menuItemElement._actionId);
        delete menuItemElement._actionId;
      }
      return;
    }

    this._showSubMenu(menuItemElement);
    event.consume();
  }

  _showSubMenu(menuItemElement) {
    if (menuItemElement._subMenuTimer) {
      clearTimeout(menuItemElement._subMenuTimer);
      delete menuItemElement._subMenuTimer;
    }
    if (this._subMenu) {
      return;
    }

    this._subMenu = new SoftContextMenu(menuItemElement._subItems, this._itemSelectedCallback, this);
    const anchorBox = menuItemElement.boxInWindow();
    // Adjust for padding.
    anchorBox.y -= 5;
    anchorBox.x += 3;
    anchorBox.width -= 6;
    anchorBox.height += 10;
    this._subMenu.show(this._document, anchorBox);
  }

  _menuItemMouseOver(event) {
    this._highlightMenuItem(event.target, true);
  }

  _menuItemMouseLeave(event) {
    if (!this._subMenu || !event.relatedTarget) {
      this._highlightMenuItem(null, true);
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (relatedTarget === this._contextMenuElement) {
      this._highlightMenuItem(null, true);
    }
  }

  /**
   * @param {?Element} menuItemElement
   * @param {boolean} scheduleSubMenu
   */
  _highlightMenuItem(menuItemElement, scheduleSubMenu) {
    if (this._highlightedMenuItemElement === menuItemElement) {
      return;
    }

    if (this._subMenu) {
      this._subMenu.discard();
    }
    if (this._highlightedMenuItemElement) {
      this._highlightedMenuItemElement.classList.remove('force-white-icons');
      this._highlightedMenuItemElement.classList.remove('soft-context-menu-item-mouse-over');
      if (this._highlightedMenuItemElement._subItems && this._highlightedMenuItemElement._subMenuTimer) {
        clearTimeout(this._highlightedMenuItemElement._subMenuTimer);
        delete this._highlightedMenuItemElement._subMenuTimer;
      }
    }
    this._highlightedMenuItemElement = menuItemElement;
    if (this._highlightedMenuItemElement) {
      if (UI.themeSupport.hasTheme() || Host.isMac()) {
        this._highlightedMenuItemElement.classList.add('force-white-icons');
      }
      this._highlightedMenuItemElement.classList.add('soft-context-menu-item-mouse-over');
      if (this._highlightedMenuItemElement._customElement) {
        this._highlightedMenuItemElement._customElement.focus();
      } else {
        this._highlightedMenuItemElement.focus();
      }
      if (scheduleSubMenu && this._highlightedMenuItemElement._subItems &&
          !this._highlightedMenuItemElement._subMenuTimer) {
        this._highlightedMenuItemElement._subMenuTimer =
            setTimeout(this._showSubMenu.bind(this, this._highlightedMenuItemElement), 150);
      }
    }
  }

  _highlightPrevious() {
    let menuItemElement = this._highlightedMenuItemElement ? this._highlightedMenuItemElement.previousSibling :
                                                             this._contextMenuElement.lastChild;
    while (menuItemElement &&
           (menuItemElement._isSeparator || menuItemElement.classList.contains('soft-context-menu-disabled'))) {
      menuItemElement = menuItemElement.previousSibling;
    }
    if (menuItemElement) {
      this._highlightMenuItem(menuItemElement, false);
    }
  }

  _highlightNext() {
    let menuItemElement = this._highlightedMenuItemElement ? this._highlightedMenuItemElement.nextSibling :
                                                             this._contextMenuElement.firstChild;
    while (menuItemElement &&
           (menuItemElement._isSeparator || menuItemElement.classList.contains('soft-context-menu-disabled'))) {
      menuItemElement = menuItemElement.nextSibling;
    }
    if (menuItemElement) {
      this._highlightMenuItem(menuItemElement, false);
    }
  }

  _menuKeyDown(event) {
    switch (event.key) {
      case 'ArrowUp':
        this._highlightPrevious();
        break;
      case 'ArrowDown':
        this._highlightNext();
        break;
      case 'ArrowLeft':
        if (this._parentMenu) {
          this._highlightMenuItem(null, false);
          this.discard();
        }
        break;
      case 'ArrowRight':
        if (!this._highlightedMenuItemElement) {
          break;
        }
        if (this._highlightedMenuItemElement._subItems) {
          this._showSubMenu(this._highlightedMenuItemElement);
          this._subMenu._highlightNext();
        }
        break;
      case 'Escape':
        this.discard();
        break;
      case 'Enter':
        if (!isEnterKey(event)) {
          return;
        }
      // Fall through
      case ' ':  // Space
        if (!this._highlightedMenuItemElement || this._highlightedMenuItemElement._customElement) {
          return;
        }
        this._triggerAction(this._highlightedMenuItemElement, event);
        if (this._highlightedMenuItemElement._subItems) {
          this._subMenu._highlightNext();
        }
        break;
    }
    event.consume(true);
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SoftContextMenu = SoftContextMenu;

var SoftContextMenu$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SoftContextMenu
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @template T
 * @implements {UI.ListDelegate<T>}
 */
class SoftDropDown {
  /**
   * @param {!UI.ListModel<T>} model
   * @param {!Delegate<T>} delegate
   */
  constructor(model, delegate) {
    this._delegate = delegate;
    this._selectedItem = null;
    this._model = model;

    this._placeholderText = ls`(no item selected)`;

    this.element = createElementWithClass('button', 'soft-dropdown');
    UI.appendStyle(this.element, 'ui/softDropDownButton.css');
    this._titleElement = this.element.createChild('span', 'title');
    const dropdownArrowIcon = UI.Icon.create('smallicon-triangle-down');
    this.element.appendChild(dropdownArrowIcon);
    UI.ARIAUtils.setExpanded(this.element, false);

    this._glassPane = new UI.GlassPane();
    this._glassPane.setMarginBehavior(UI.GlassPane.MarginBehavior.NoMargin);
    this._glassPane.setAnchorBehavior(UI.GlassPane.AnchorBehavior.PreferBottom);
    this._glassPane.setOutsideClickCallback(this._hide.bind(this));
    this._glassPane.setPointerEventsBehavior(UI.GlassPane.PointerEventsBehavior.BlockedByGlassPane);
    this._list = new UI.ListControl(model, this, UI.ListMode.EqualHeightItems);
    this._list.element.classList.add('item-list');
    this._rowHeight = 36;
    this._width = 315;
    UI.createShadowRootWithCoreStyles(this._glassPane.contentElement, 'ui/softDropDown.css')
        .createChild('div', 'list-container')  // issue #972755
        .appendChild(this._list.element);
    UI.ARIAUtils.markAsMenu(this._list.element);

    this._listWasShowing200msAgo = false;
    this.element.addEventListener('mousedown', event => {
      if (this._listWasShowing200msAgo) {
        this._hide(event);
      } else if (!this.element.disabled) {
        this._show(event);
      }
    }, false);
    this.element.addEventListener('keydown', this._onKeyDownButton.bind(this), false);
    this._list.element.addEventListener('keydown', this._onKeyDownList.bind(this), false);
    this._list.element.addEventListener('focusout', this._hide.bind(this), false);
    this._list.element.addEventListener('mousedown', event => event.consume(true), false);
    this._list.element.addEventListener('mouseup', event => {
      if (event.target === this._list.element) {
        return;
      }

      if (!this._listWasShowing200msAgo) {
        return;
      }
      this._selectHighlightedItem();
      this._hide(event);
    }, false);
    model.addEventListener(UI.ListModel.Events.ItemsReplaced, this._itemsReplaced, this);
  }

  /**
   * @param {!Event} event
   */
  _show(event) {
    if (this._glassPane.isShowing()) {
      return;
    }
    this._glassPane.setContentAnchorBox(this.element.boxInWindow());
    this._glassPane.show(/** @type {!Document} **/ (this.element.ownerDocument));
    this._list.element.focus();
    UI.ARIAUtils.setExpanded(this.element, true);
    this._updateGlasspaneSize();
    if (this._selectedItem) {
      this._list.selectItem(this._selectedItem);
    }
    event.consume(true);
    setTimeout(() => this._listWasShowing200msAgo = true, 200);
  }

  _updateGlasspaneSize() {
    const maxHeight = this._rowHeight * (Math.min(this._model.length, 9));
    this._glassPane.setMaxContentSize(new UI.Size(this._width, maxHeight));
    this._list.viewportResized();
  }

  /**
   * @param {!Event} event
   */
  _hide(event) {
    setTimeout(() => this._listWasShowing200msAgo = false, 200);
    this._glassPane.hide();
    this._list.selectItem(null);
    UI.ARIAUtils.setExpanded(this.element, false);
    this.element.focus();
    event.consume(true);
  }

  /**
   * @param {!Event} event
   */
  _onKeyDownButton(event) {
    let handled = false;
    switch (event.key) {
      case 'ArrowUp':
        this._show(event);
        this._list.selectItemNextPage();
        handled = true;
        break;
      case 'ArrowDown':
        this._show(event);
        this._list.selectItemPreviousPage();
        handled = true;
        break;
      case 'Enter':
      case ' ':
        this._show(event);
        handled = true;
        break;
    }

    if (handled) {
      event.consume(true);
    }
  }

  /**
   * @param {!Event} event
   */
  _onKeyDownList(event) {
    let handled = false;
    switch (event.key) {
      case 'ArrowLeft':
        handled = this._list.selectPreviousItem(false, false);
        break;
      case 'ArrowRight':
        handled = this._list.selectNextItem(false, false);
        break;
      case 'Home':
        for (let i = 0; i < this._model.length; i++) {
          if (this.isItemSelectable(this._model.at(i))) {
            this._list.selectItem(this._model.at(i));
            handled = true;
            break;
          }
        }
        break;
      case 'End':
        for (let i = this._model.length - 1; i >= 0; i--) {
          if (this.isItemSelectable(this._model.at(i))) {
            this._list.selectItem(this._model.at(i));
            handled = true;
            break;
          }
        }
        break;
      case 'Escape':
        this._hide(event);
        handled = true;
        break;
      case 'Tab':
      case 'Enter':
      case ' ':
        this._selectHighlightedItem();
        this._hide(event);
        handled = true;
        break;
      default:
        if (event.key.length === 1) {
          const selectedIndex = this._list.selectedIndex();
          const letter = event.key.toUpperCase();
          for (let i = 0; i < this._model.length; i++) {
            const item = this._model.at((selectedIndex + i + 1) % this._model.length);
            if (this._delegate.titleFor(item).toUpperCase().startsWith(letter)) {
              this._list.selectItem(item);
              break;
            }
          }
          handled = true;
        }
        break;
    }

    if (handled) {
      event.consume(true);
    }
  }

  /**
   * @param {number} width
   */
  setWidth(width) {
    this._width = width;
    this._updateGlasspaneSize();
  }

  /**
   * @param {number} rowHeight
   */
  setRowHeight(rowHeight) {
    this._rowHeight = rowHeight;
  }

  /**
   * @param {string} text
   */
  setPlaceholderText(text) {
    this._placeholderText = text;
    if (!this._selectedItem) {
      this._titleElement.textContent = this._placeholderText;
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _itemsReplaced(event) {
    const removed = /** @type {!Array<T>} */ (event.data.removed);
    if (removed.indexOf(this._selectedItem) !== -1) {
      this._selectedItem = null;
      this._selectHighlightedItem();
    }
    this._updateGlasspaneSize();
  }

  /**
   * @param {?T} item
   */
  selectItem(item) {
    this._selectedItem = item;
    if (this._selectedItem) {
      this._titleElement.textContent = this._delegate.titleFor(this._selectedItem);
    } else {
      this._titleElement.textContent = this._placeholderText;
    }
    this._delegate.itemSelected(this._selectedItem);
  }

  /**
   * @override
   * @param {T} item
   * @return {!Element}
   */
  createElementForItem(item) {
    const element = createElementWithClass('div', 'item');
    element.addEventListener('mousemove', e => {
      if ((e.movementX || e.movementY) && this._delegate.isItemSelectable(item)) {
        this._list.selectItem(item, false, /* Don't scroll */ true);
      }
    });
    element.classList.toggle('disabled', !this._delegate.isItemSelectable(item));
    element.classList.toggle('highlighted', this._list.selectedItem() === item);

    UI.ARIAUtils.markAsMenuItem(element);
    element.appendChild(this._delegate.createElementForItem(item));

    return element;
  }

  /**
   * @override
   * @param {T} item
   * @return {number}
   */
  heightForItem(item) {
    return this._rowHeight;
  }

  /**
   * @override
   * @param {T} item
   * @return {boolean}
   */
  isItemSelectable(item) {
    return this._delegate.isItemSelectable(item);
  }

  /**
   * @override
   * @param {?T} from
   * @param {?T} to
   * @param {?Element} fromElement
   * @param {?Element} toElement
   */
  selectedItemChanged(from, to, fromElement, toElement) {
    if (fromElement) {
      fromElement.classList.remove('highlighted');
    }
    if (toElement) {
      toElement.classList.add('highlighted');
    }

    UI.ARIAUtils.setActiveDescendant(this._list.element, toElement);
    this._delegate.highlightedItemChanged(
        from, to, fromElement && fromElement.firstElementChild, toElement && toElement.firstElementChild);
  }

  _selectHighlightedItem() {
    this.selectItem(this._list.selectedItem());
  }

  /**
   * @param {T} item
   */
  refreshItem(item) {
    this._list.refreshItem(item);
  }
}

/**
 * @interface
 * @template T
 */
class Delegate {
  /**
   * @param {T} item
   * @return {string}
   */
  titleFor(item) {
  }

  /**
   * @param {T} item
   * @return {!Element}
   */
  createElementForItem(item) {
  }

  /**
   * @param {T} item
   * @return {boolean}
   */
  isItemSelectable(item) {
  }

  /**
   * @param {?T} item
   */
  itemSelected(item) {
  }

  /**
   * @param {?T} from
   * @param {?T} to
   * @param {?Element} fromElement
   * @param {?Element} toElement
   */
  highlightedItemChanged(from, to, fromElement, toElement) {
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SoftDropDown = SoftDropDown;

/**
 * @interface
 * @template T
 */
UI.SoftDropDown.Delegate = Delegate;

var SoftDropDown$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SoftDropDown,
  Delegate: Delegate
});

/*
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. AND ITS CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GOOGLE INC.
 * OR ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class SplitWidget extends UI.Widget {
  /**
   * @param {boolean} isVertical
   * @param {boolean} secondIsSidebar
   * @param {string=} settingName
   * @param {number=} defaultSidebarWidth
   * @param {number=} defaultSidebarHeight
   * @param {boolean=} constraintsInDip
   */
  constructor(isVertical, secondIsSidebar, settingName, defaultSidebarWidth, defaultSidebarHeight, constraintsInDip) {
    super(true);
    this.element.classList.add('split-widget');
    this.registerRequiredCSS('ui/splitWidget.css');

    this.contentElement.classList.add('shadow-split-widget');
    this._sidebarElement =
        this.contentElement.createChild('div', 'shadow-split-widget-contents shadow-split-widget-sidebar vbox');
    this._mainElement =
        this.contentElement.createChild('div', 'shadow-split-widget-contents shadow-split-widget-main vbox');
    this._mainElement.createChild('slot').name = 'insertion-point-main';
    this._sidebarElement.createChild('slot').name = 'insertion-point-sidebar';
    this._resizerElement = this.contentElement.createChild('div', 'shadow-split-widget-resizer');
    this._resizerElementSize = null;

    this._resizerWidget = new UI.SimpleResizerWidget();
    this._resizerWidget.setEnabled(true);
    this._resizerWidget.addEventListener(UI.ResizerWidget.Events.ResizeStart, this._onResizeStart, this);
    this._resizerWidget.addEventListener(UI.ResizerWidget.Events.ResizeUpdate, this._onResizeUpdate, this);
    this._resizerWidget.addEventListener(UI.ResizerWidget.Events.ResizeEnd, this._onResizeEnd, this);

    this._defaultSidebarWidth = defaultSidebarWidth || 200;
    this._defaultSidebarHeight = defaultSidebarHeight || this._defaultSidebarWidth;
    this._constraintsInDip = !!constraintsInDip;
    this._resizeStartSizeDIP = 0;
    this._setting = settingName ? Common.settings.createSetting(settingName, {}) : null;

    this._totalSizeCSS = 0;
    this._totalSizeOtherDimensionCSS = 0;
    /** @type {?UI.Widget} */
    this._mainWidget = null;
    /** @type {?UI.Widget} */
    this._sidebarWidget = null;
    this._animationFrameHandle = 0;
    /** @type {?function()} */
    this._animationCallback = null;
    this._showHideSidebarButtonTitle = '';
    /** @type {?UI.ToolbarButton} */
    this._showHideSidebarButton = null;
    this._isVertical = false;
    this._sidebarMinimized = false;
    this._detaching = false;
    this._sidebarSizeDIP = -1;
    this._savedSidebarSizeDIP = this._sidebarSizeDIP;
    this._secondIsSidebar = false;
    this._shouldSaveShowMode = false;
    /** @type {?number} */
    this._savedVerticalMainSize = null;
    /** @type {?number} */
    this._savedHorizontalMainSize = null;

    this.setSecondIsSidebar(secondIsSidebar);

    this._innerSetVertical(isVertical);
    this._showMode = ShowMode.Both;
    this._savedShowMode = this._showMode;

    // Should be called after isVertical has the right value.
    this.installResizer(this._resizerElement);
  }

  /**
   * @return {boolean}
   */
  isVertical() {
    return this._isVertical;
  }

  /**
   * @param {boolean} isVertical
   */
  setVertical(isVertical) {
    if (this._isVertical === isVertical) {
      return;
    }

    this._innerSetVertical(isVertical);

    if (this.isShowing()) {
      this._updateLayout();
    }
  }

  /**
   * @param {boolean} isVertical
   */
  _innerSetVertical(isVertical) {
    this.contentElement.classList.toggle('vbox', !isVertical);
    this.contentElement.classList.toggle('hbox', isVertical);
    this._isVertical = isVertical;

    this._resizerElementSize = null;
    this._sidebarSizeDIP = -1;
    this._restoreSidebarSizeFromSettings();
    if (this._shouldSaveShowMode) {
      this._restoreAndApplyShowModeFromSettings();
    }
    this._updateShowHideSidebarButton();
    // FIXME: reverse SplitWidget.isVertical meaning.
    this._resizerWidget.setVertical(!isVertical);
    this.invalidateConstraints();
  }

  /**
   * @param {boolean=} animate
   */
  _updateLayout(animate) {
    this._totalSizeCSS = 0;  // Lazy update.
    this._totalSizeOtherDimensionCSS = 0;

    // Remove properties that might affect total size calculation.
    this._mainElement.style.removeProperty('width');
    this._mainElement.style.removeProperty('height');
    this._sidebarElement.style.removeProperty('width');
    this._sidebarElement.style.removeProperty('height');

    this._innerSetSidebarSizeDIP(this._preferredSidebarSizeDIP(), !!animate);
  }

  /**
   * @param {!UI.Widget} widget
   */
  setMainWidget(widget) {
    if (this._mainWidget === widget) {
      return;
    }
    this.suspendInvalidations();
    if (this._mainWidget) {
      this._mainWidget.detach();
    }
    this._mainWidget = widget;
    if (widget) {
      widget.element.slot = 'insertion-point-main';
      if (this._showMode === ShowMode.OnlyMain || this._showMode === ShowMode.Both) {
        widget.show(this.element);
      }
    }
    this.resumeInvalidations();
  }

  /**
   * @param {!UI.Widget} widget
   */
  setSidebarWidget(widget) {
    if (this._sidebarWidget === widget) {
      return;
    }
    this.suspendInvalidations();
    if (this._sidebarWidget) {
      this._sidebarWidget.detach();
    }
    this._sidebarWidget = widget;
    if (widget) {
      widget.element.slot = 'insertion-point-sidebar';
      if (this._showMode === ShowMode.OnlySidebar || this._showMode === ShowMode.Both) {
        widget.show(this.element);
      }
    }
    this.resumeInvalidations();
  }

  /**
   * @return {?UI.Widget}
   */
  mainWidget() {
    return this._mainWidget;
  }

  /**
   * @return {?UI.Widget}
   */
  sidebarWidget() {
    return this._sidebarWidget;
  }

  /**
   * @override
   * @param {!UI.Widget} widget
   */
  childWasDetached(widget) {
    if (this._detaching) {
      return;
    }
    if (this._mainWidget === widget) {
      this._mainWidget = null;
    }
    if (this._sidebarWidget === widget) {
      this._sidebarWidget = null;
    }
    this.invalidateConstraints();
  }

  /**
   * @return {boolean}
   */
  isSidebarSecond() {
    return this._secondIsSidebar;
  }

  enableShowModeSaving() {
    this._shouldSaveShowMode = true;
    this._restoreAndApplyShowModeFromSettings();
  }

  /**
   * @return {string}
   */
  showMode() {
    return this._showMode;
  }

  /**
   * @param {boolean} secondIsSidebar
   */
  setSecondIsSidebar(secondIsSidebar) {
    if (secondIsSidebar === this._secondIsSidebar) {
      return;
    }
    this._secondIsSidebar = secondIsSidebar;
    if (!this._mainWidget || !this._mainWidget.shouldHideOnDetach()) {
      if (secondIsSidebar) {
        this.contentElement.insertBefore(this._mainElement, this._sidebarElement);
      } else {
        this.contentElement.insertBefore(this._mainElement, this._resizerElement);
      }
    } else if (!this._sidebarWidget || !this._sidebarWidget.shouldHideOnDetach()) {
      if (secondIsSidebar) {
        this.contentElement.insertBefore(this._sidebarElement, this._resizerElement);
      } else {
        this.contentElement.insertBefore(this._sidebarElement, this._mainElement);
      }
    } else {
      console.error('Could not swap split widget side. Both children widgets contain iframes.');
      this._secondIsSidebar = !secondIsSidebar;
    }
  }

  /**
   * @return {?string}
   */
  sidebarSide() {
    if (this._showMode !== ShowMode.Both) {
      return null;
    }
    return this._isVertical ? (this._secondIsSidebar ? 'right' : 'left') : (this._secondIsSidebar ? 'bottom' : 'top');
  }

  /**
   * @return {!Element}
   */
  resizerElement() {
    return this._resizerElement;
  }

  /**
   * @param {boolean=} animate
   */
  hideMain(animate) {
    this._showOnly(this._sidebarWidget, this._mainWidget, this._sidebarElement, this._mainElement, animate);
    this._updateShowMode(ShowMode.OnlySidebar);
  }

  /**
   * @param {boolean=} animate
   */
  hideSidebar(animate) {
    this._showOnly(this._mainWidget, this._sidebarWidget, this._mainElement, this._sidebarElement, animate);
    this._updateShowMode(ShowMode.OnlyMain);
  }

  /**
   * @param {boolean} minimized
   */
  setSidebarMinimized(minimized) {
    this._sidebarMinimized = minimized;
    this.invalidateConstraints();
  }

  /**
   * @return {boolean}
   */
  isSidebarMinimized() {
    return this._sidebarMinimized;
  }

  /**
   * @param {?UI.Widget} sideToShow
   * @param {?UI.Widget} sideToHide
   * @param {!Element} shadowToShow
   * @param {!Element} shadowToHide
   * @param {boolean=} animate
   */
  _showOnly(sideToShow, sideToHide, shadowToShow, shadowToHide, animate) {
    this._cancelAnimation();

    /**
     * @this {SplitWidget}
     */
    function callback() {
      if (sideToShow) {
        // Make sure main is first in the children list.
        if (sideToShow === this._mainWidget) {
          this._mainWidget.show(this.element, this._sidebarWidget ? this._sidebarWidget.element : null);
        } else {
          this._sidebarWidget.show(this.element);
        }
      }
      if (sideToHide) {
        this._detaching = true;
        sideToHide.detach();
        this._detaching = false;
      }

      this._resizerElement.classList.add('hidden');
      shadowToShow.classList.remove('hidden');
      shadowToShow.classList.add('maximized');
      shadowToHide.classList.add('hidden');
      shadowToHide.classList.remove('maximized');
      this._removeAllLayoutProperties();
      this.doResize();
      this._showFinishedForTest();
    }

    if (animate) {
      this._animate(true, callback.bind(this));
    } else {
      callback.call(this);
    }

    this._sidebarSizeDIP = -1;
    this.setResizable(false);
  }

  _showFinishedForTest() {
    // This method is sniffed in tests.
  }

  _removeAllLayoutProperties() {
    this._sidebarElement.style.removeProperty('flexBasis');

    this._mainElement.style.removeProperty('width');
    this._mainElement.style.removeProperty('height');
    this._sidebarElement.style.removeProperty('width');
    this._sidebarElement.style.removeProperty('height');

    this._resizerElement.style.removeProperty('left');
    this._resizerElement.style.removeProperty('right');
    this._resizerElement.style.removeProperty('top');
    this._resizerElement.style.removeProperty('bottom');

    this._resizerElement.style.removeProperty('margin-left');
    this._resizerElement.style.removeProperty('margin-right');
    this._resizerElement.style.removeProperty('margin-top');
    this._resizerElement.style.removeProperty('margin-bottom');
  }

  /**
   * @param {boolean=} animate
   */
  showBoth(animate) {
    if (this._showMode === ShowMode.Both) {
      animate = false;
    }

    this._cancelAnimation();
    this._mainElement.classList.remove('maximized', 'hidden');
    this._sidebarElement.classList.remove('maximized', 'hidden');
    this._resizerElement.classList.remove('hidden');
    this.setResizable(true);

    // Make sure main is the first in the children list.
    this.suspendInvalidations();
    if (this._sidebarWidget) {
      this._sidebarWidget.show(this.element);
    }
    if (this._mainWidget) {
      this._mainWidget.show(this.element, this._sidebarWidget ? this._sidebarWidget.element : null);
    }
    this.resumeInvalidations();
    // Order widgets in DOM properly.
    this.setSecondIsSidebar(this._secondIsSidebar);

    this._sidebarSizeDIP = -1;
    this._updateShowMode(ShowMode.Both);
    this._updateLayout(animate);
  }

  /**
   * @param {boolean} resizable
   */
  setResizable(resizable) {
    this._resizerWidget.setEnabled(resizable);
  }

  /**
   * @return {boolean}
   */
  isResizable() {
    return this._resizerWidget.isEnabled();
  }

  /**
   * @param {number} size
   */
  setSidebarSize(size) {
    const sizeDIP = UI.zoomManager.cssToDIP(size);
    this._savedSidebarSizeDIP = sizeDIP;
    this._saveSetting();
    this._innerSetSidebarSizeDIP(sizeDIP, false, true);
  }

  /**
   * @return {number}
   */
  sidebarSize() {
    const sizeDIP = Math.max(0, this._sidebarSizeDIP);
    return UI.zoomManager.dipToCSS(sizeDIP);
  }

  /**
   * Returns total size in DIP.
   * @return {number}
   */
  _totalSizeDIP() {
    if (!this._totalSizeCSS) {
      this._totalSizeCSS = this._isVertical ? this.contentElement.offsetWidth : this.contentElement.offsetHeight;
      this._totalSizeOtherDimensionCSS =
          this._isVertical ? this.contentElement.offsetHeight : this.contentElement.offsetWidth;
    }
    return UI.zoomManager.cssToDIP(this._totalSizeCSS);
  }

  /**
   * @param {string} showMode
   */
  _updateShowMode(showMode) {
    this._showMode = showMode;
    this._saveShowModeToSettings();
    this._updateShowHideSidebarButton();
    this.dispatchEventToListeners(SplitWidget.Events.ShowModeChanged, showMode);
    this.invalidateConstraints();
  }

  /**
   * @param {number} sizeDIP
   * @param {boolean} animate
   * @param {boolean=} userAction
   */
  _innerSetSidebarSizeDIP(sizeDIP, animate, userAction) {
    if (this._showMode !== ShowMode.Both || !this.isShowing()) {
      return;
    }

    sizeDIP = this._applyConstraints(sizeDIP, userAction);
    if (this._sidebarSizeDIP === sizeDIP) {
      return;
    }

    if (!this._resizerElementSize) {
      this._resizerElementSize =
          this._isVertical ? this._resizerElement.offsetWidth : this._resizerElement.offsetHeight;
    }

    // Invalidate layout below.

    this._removeAllLayoutProperties();

    // this._totalSizeDIP is available below since we successfully applied constraints.
    const roundSizeCSS = Math.round(UI.zoomManager.dipToCSS(sizeDIP));
    const sidebarSizeValue = roundSizeCSS + 'px';
    const mainSizeValue = (this._totalSizeCSS - roundSizeCSS) + 'px';
    this._sidebarElement.style.flexBasis = sidebarSizeValue;

    // Make both sides relayout boundaries.
    if (this._isVertical) {
      this._sidebarElement.style.width = sidebarSizeValue;
      this._mainElement.style.width = mainSizeValue;
      this._sidebarElement.style.height = this._totalSizeOtherDimensionCSS + 'px';
      this._mainElement.style.height = this._totalSizeOtherDimensionCSS + 'px';
    } else {
      this._sidebarElement.style.height = sidebarSizeValue;
      this._mainElement.style.height = mainSizeValue;
      this._sidebarElement.style.width = this._totalSizeOtherDimensionCSS + 'px';
      this._mainElement.style.width = this._totalSizeOtherDimensionCSS + 'px';
    }

    // Position resizer.
    if (this._isVertical) {
      if (this._secondIsSidebar) {
        this._resizerElement.style.right = sidebarSizeValue;
        this._resizerElement.style.marginRight = -this._resizerElementSize / 2 + 'px';
      } else {
        this._resizerElement.style.left = sidebarSizeValue;
        this._resizerElement.style.marginLeft = -this._resizerElementSize / 2 + 'px';
      }
    } else {
      if (this._secondIsSidebar) {
        this._resizerElement.style.bottom = sidebarSizeValue;
        this._resizerElement.style.marginBottom = -this._resizerElementSize / 2 + 'px';
      } else {
        this._resizerElement.style.top = sidebarSizeValue;
        this._resizerElement.style.marginTop = -this._resizerElementSize / 2 + 'px';
      }
    }

    this._sidebarSizeDIP = sizeDIP;

    // Force layout.

    if (animate) {
      this._animate(false);
    } else {
      // No need to recalculate this._sidebarSizeDIP and this._totalSizeDIP again.
      this.doResize();
      this.dispatchEventToListeners(SplitWidget.Events.SidebarSizeChanged, this.sidebarSize());
    }
  }

  /**
   * @param {boolean} reverse
   * @param {function()=} callback
   */
  _animate(reverse, callback) {
    const animationTime = 50;
    this._animationCallback = callback || null;

    let animatedMarginPropertyName;
    if (this._isVertical) {
      animatedMarginPropertyName = this._secondIsSidebar ? 'margin-right' : 'margin-left';
    } else {
      animatedMarginPropertyName = this._secondIsSidebar ? 'margin-bottom' : 'margin-top';
    }

    const marginFrom = reverse ? '0' : '-' + UI.zoomManager.dipToCSS(this._sidebarSizeDIP) + 'px';
    const marginTo = reverse ? '-' + UI.zoomManager.dipToCSS(this._sidebarSizeDIP) + 'px' : '0';

    // This order of things is important.
    // 1. Resize main element early and force layout.
    this.contentElement.style.setProperty(animatedMarginPropertyName, marginFrom);
    if (!reverse) {
      suppressUnused(this._mainElement.offsetWidth);
      suppressUnused(this._sidebarElement.offsetWidth);
    }

    // 2. Issue onresize to the sidebar element, its size won't change.
    if (!reverse) {
      this._sidebarWidget.doResize();
    }

    // 3. Configure and run animation
    this.contentElement.style.setProperty('transition', animatedMarginPropertyName + ' ' + animationTime + 'ms linear');

    const boundAnimationFrame = animationFrame.bind(this);
    let startTime;
    /**
     * @this {SplitWidget}
     */
    function animationFrame() {
      this._animationFrameHandle = 0;

      if (!startTime) {
        // Kick animation on first frame.
        this.contentElement.style.setProperty(animatedMarginPropertyName, marginTo);
        startTime = window.performance.now();
      } else if (window.performance.now() < startTime + animationTime) {
        // Process regular animation frame.
        if (this._mainWidget) {
          this._mainWidget.doResize();
        }
      } else {
        // Complete animation.
        this._cancelAnimation();
        if (this._mainWidget) {
          this._mainWidget.doResize();
        }
        this.dispatchEventToListeners(SplitWidget.Events.SidebarSizeChanged, this.sidebarSize());
        return;
      }
      this._animationFrameHandle = this.contentElement.window().requestAnimationFrame(boundAnimationFrame);
    }
    this._animationFrameHandle = this.contentElement.window().requestAnimationFrame(boundAnimationFrame);
  }

  _cancelAnimation() {
    this.contentElement.style.removeProperty('margin-top');
    this.contentElement.style.removeProperty('margin-right');
    this.contentElement.style.removeProperty('margin-bottom');
    this.contentElement.style.removeProperty('margin-left');
    this.contentElement.style.removeProperty('transition');

    if (this._animationFrameHandle) {
      this.contentElement.window().cancelAnimationFrame(this._animationFrameHandle);
      this._animationFrameHandle = 0;
    }
    if (this._animationCallback) {
      this._animationCallback();
      this._animationCallback = null;
    }
  }

  /**
   * @param {number} sidebarSize
   * @param {boolean=} userAction
   * @return {number}
   */
  _applyConstraints(sidebarSize, userAction) {
    const totalSize = this._totalSizeDIP();
    const zoomFactor = this._constraintsInDip ? 1 : UI.zoomManager.zoomFactor();

    let constraints = this._sidebarWidget ? this._sidebarWidget.constraints() : new UI.Constraints();
    let minSidebarSize = this.isVertical() ? constraints.minimum.width : constraints.minimum.height;
    if (!minSidebarSize) {
      minSidebarSize = MinPadding;
    }
    minSidebarSize *= zoomFactor;
    if (this._sidebarMinimized) {
      sidebarSize = minSidebarSize;
    }

    let preferredSidebarSize = this.isVertical() ? constraints.preferred.width : constraints.preferred.height;
    if (!preferredSidebarSize) {
      preferredSidebarSize = MinPadding;
    }
    preferredSidebarSize *= zoomFactor;
    // Allow sidebar to be less than preferred by explicit user action.
    if (sidebarSize < preferredSidebarSize) {
      preferredSidebarSize = Math.max(sidebarSize, minSidebarSize);
    }
    preferredSidebarSize += zoomFactor;  // 1 css pixel for splitter border.

    constraints = this._mainWidget ? this._mainWidget.constraints() : new UI.Constraints();
    let minMainSize = this.isVertical() ? constraints.minimum.width : constraints.minimum.height;
    if (!minMainSize) {
      minMainSize = MinPadding;
    }
    minMainSize *= zoomFactor;

    let preferredMainSize = this.isVertical() ? constraints.preferred.width : constraints.preferred.height;
    if (!preferredMainSize) {
      preferredMainSize = MinPadding;
    }
    preferredMainSize *= zoomFactor;
    const savedMainSize = this.isVertical() ? this._savedVerticalMainSize : this._savedHorizontalMainSize;
    if (savedMainSize !== null) {
      preferredMainSize = Math.min(preferredMainSize, savedMainSize * zoomFactor);
    }
    if (userAction) {
      preferredMainSize = minMainSize;
    }

    // Enough space for preferred.
    const totalPreferred = preferredMainSize + preferredSidebarSize;
    if (totalPreferred <= totalSize) {
      return Number.constrain(sidebarSize, preferredSidebarSize, totalSize - preferredMainSize);
    }

    // Enough space for minimum.
    if (minMainSize + minSidebarSize <= totalSize) {
      const delta = totalPreferred - totalSize;
      const sidebarDelta = delta * preferredSidebarSize / totalPreferred;
      sidebarSize = preferredSidebarSize - sidebarDelta;
      return Number.constrain(sidebarSize, minSidebarSize, totalSize - minMainSize);
    }

    // Not enough space even for minimum sizes.
    return Math.max(0, totalSize - minMainSize);
  }

  /**
   * @override
   */
  wasShown() {
    this._forceUpdateLayout();
    UI.zoomManager.addEventListener(UI.ZoomManager.Events.ZoomChanged, this._onZoomChanged, this);
  }

  /**
   * @override
   */
  willHide() {
    UI.zoomManager.removeEventListener(UI.ZoomManager.Events.ZoomChanged, this._onZoomChanged, this);
  }

  /**
   * @override
   */
  onResize() {
    this._updateLayout();
  }

  /**
   * @override
   */
  onLayout() {
    this._updateLayout();
  }

  /**
   * @override
   * @return {!UI.Constraints}
   */
  calculateConstraints() {
    if (this._showMode === ShowMode.OnlyMain) {
      return this._mainWidget ? this._mainWidget.constraints() : new UI.Constraints();
    }
    if (this._showMode === ShowMode.OnlySidebar) {
      return this._sidebarWidget ? this._sidebarWidget.constraints() : new UI.Constraints();
    }

    let mainConstraints = this._mainWidget ? this._mainWidget.constraints() : new UI.Constraints();
    let sidebarConstraints = this._sidebarWidget ? this._sidebarWidget.constraints() : new UI.Constraints();
    const min = MinPadding;
    if (this._isVertical) {
      mainConstraints = mainConstraints.widthToMax(min).addWidth(1);  // 1 for splitter
      sidebarConstraints = sidebarConstraints.widthToMax(min);
      return mainConstraints.addWidth(sidebarConstraints).heightToMax(sidebarConstraints);
    } else {
      mainConstraints = mainConstraints.heightToMax(min).addHeight(1);  // 1 for splitter
      sidebarConstraints = sidebarConstraints.heightToMax(min);
      return mainConstraints.widthToMax(sidebarConstraints).addHeight(sidebarConstraints);
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _onResizeStart(event) {
    this._resizeStartSizeDIP = this._sidebarSizeDIP;
  }

  /**
   * @param {!Common.Event} event
   */
  _onResizeUpdate(event) {
    const offset = event.data.currentPosition - event.data.startPosition;
    const offsetDIP = UI.zoomManager.cssToDIP(offset);
    const newSizeDIP =
        this._secondIsSidebar ? this._resizeStartSizeDIP - offsetDIP : this._resizeStartSizeDIP + offsetDIP;
    const constrainedSizeDIP = this._applyConstraints(newSizeDIP, true);
    this._savedSidebarSizeDIP = constrainedSizeDIP;
    this._saveSetting();
    this._innerSetSidebarSizeDIP(constrainedSizeDIP, false, true);
    if (this.isVertical()) {
      this._savedVerticalMainSize = this._totalSizeDIP() - this._sidebarSizeDIP;
    } else {
      this._savedHorizontalMainSize = this._totalSizeDIP() - this._sidebarSizeDIP;
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _onResizeEnd(event) {
    this._resizeStartSizeDIP = 0;
  }

  /**
   * @param {boolean=} noSplitter
   */
  hideDefaultResizer(noSplitter) {
    this.uninstallResizer(this._resizerElement);
    this._sidebarElement.classList.toggle('no-default-splitter', !!noSplitter);
  }

  /**
   * @param {!Element} resizerElement
   */
  installResizer(resizerElement) {
    this._resizerWidget.addElement(resizerElement);
  }

  /**
   * @param {!Element} resizerElement
   */
  uninstallResizer(resizerElement) {
    this._resizerWidget.removeElement(resizerElement);
  }

  /**
   * @return {boolean}
   */
  hasCustomResizer() {
    const elements = this._resizerWidget.elements();
    return elements.length > 1 || (elements.length === 1 && elements[0] !== this._resizerElement);
  }

  /**
   * @param {!Element} resizer
   * @param {boolean} on
   */
  toggleResizer(resizer, on) {
    if (on) {
      this.installResizer(resizer);
    } else {
      this.uninstallResizer(resizer);
    }
  }

  /**
   * @return {?SplitWidget.SettingForOrientation}
   */
  _settingForOrientation() {
    const state = this._setting ? this._setting.get() : {};
    return this._isVertical ? state.vertical : state.horizontal;
  }

  /**
   * @return {number}
   */
  _preferredSidebarSizeDIP() {
    let size = this._savedSidebarSizeDIP;
    if (!size) {
      size = this._isVertical ? this._defaultSidebarWidth : this._defaultSidebarHeight;
      // If we have default value in percents, calculate it on first use.
      if (0 < size && size < 1) {
        size *= this._totalSizeDIP();
      }
    }
    return size;
  }

  _restoreSidebarSizeFromSettings() {
    const settingForOrientation = this._settingForOrientation();
    this._savedSidebarSizeDIP = settingForOrientation ? settingForOrientation.size : 0;
  }

  _restoreAndApplyShowModeFromSettings() {
    const orientationState = this._settingForOrientation();
    this._savedShowMode = orientationState && orientationState.showMode ? orientationState.showMode : this._showMode;
    this._showMode = this._savedShowMode;

    switch (this._savedShowMode) {
      case ShowMode.Both:
        this.showBoth();
        break;
      case ShowMode.OnlyMain:
        this.hideSidebar();
        break;
      case ShowMode.OnlySidebar:
        this.hideMain();
        break;
    }
  }

  _saveShowModeToSettings() {
    this._savedShowMode = this._showMode;
    this._saveSetting();
  }

  _saveSetting() {
    if (!this._setting) {
      return;
    }
    const state = this._setting.get();
    const orientationState = (this._isVertical ? state.vertical : state.horizontal) || {};

    orientationState.size = this._savedSidebarSizeDIP;
    if (this._shouldSaveShowMode) {
      orientationState.showMode = this._savedShowMode;
    }

    if (this._isVertical) {
      state.vertical = orientationState;
    } else {
      state.horizontal = orientationState;
    }
    this._setting.set(state);
  }

  _forceUpdateLayout() {
    // Force layout even if sidebar size does not change.
    this._sidebarSizeDIP = -1;
    this._updateLayout();
  }

  /**
   * @param {!Common.Event} event
   */
  _onZoomChanged(event) {
    this._forceUpdateLayout();
  }

  /**
   * @param {string} title
   * @return {!UI.ToolbarButton}
   */
  createShowHideSidebarButton(title) {
    this._showHideSidebarButtonTitle = title;
    this._showHideSidebarButton = new UI.ToolbarButton('', '');
    this._showHideSidebarButton.addEventListener(UI.ToolbarButton.Events.Click, buttonClicked, this);
    this._updateShowHideSidebarButton();

    /**
     * @param {!Common.Event} event
     * @this {SplitWidget}
     */
    function buttonClicked(event) {
      if (this._showMode !== ShowMode.Both) {
        this.showBoth(true);
      } else {
        this.hideSidebar(true);
      }
    }

    return this._showHideSidebarButton;
  }

  _updateShowHideSidebarButton() {
    if (!this._showHideSidebarButton) {
      return;
    }
    const sidebarHidden = this._showMode === ShowMode.OnlyMain;
    let glyph = '';
    if (sidebarHidden) {
      glyph = this.isVertical() ?
          (this.isSidebarSecond() ? 'largeicon-show-right-sidebar' : 'largeicon-show-left-sidebar') :
          (this.isSidebarSecond() ? 'largeicon-show-bottom-sidebar' : 'largeicon-show-top-sidebar');
    } else {
      glyph = this.isVertical() ?
          (this.isSidebarSecond() ? 'largeicon-hide-right-sidebar' : 'largeicon-hide-left-sidebar') :
          (this.isSidebarSecond() ? 'largeicon-hide-bottom-sidebar' : 'largeicon-hide-top-sidebar');
    }
    this._showHideSidebarButton.setGlyph(glyph);
    this._showHideSidebarButton.setTitle(
        sidebarHidden ? Common.UIString('Show %s', this._showHideSidebarButtonTitle) :
                        Common.UIString('Hide %s', this._showHideSidebarButtonTitle));
  }
}

const ShowMode = {
  Both: 'Both',
  OnlyMain: 'OnlyMain',
  OnlySidebar: 'OnlySidebar'
};

/** @enum {symbol} */
const Events$5 = {
  SidebarSizeChanged: Symbol('SidebarSizeChanged'),
  ShowModeChanged: Symbol('ShowModeChanged')
};

const MinPadding = 20;

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SplitWidget = SplitWidget;

UI.SplitWidget.ShowMode = ShowMode;
UI.SplitWidget.MinPadding = MinPadding;

/** @enum {symbol} */
UI.SplitWidget.Events = Events$5;

/** @typedef {{showMode: string, size: number}} */
UI.SplitWidget.SettingForOrientation;

var SplitWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SplitWidget,
  ShowMode: ShowMode,
  Events: Events$5,
  MinPadding: MinPadding
});

/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * @interface
 */
class SuggestBoxDelegate {
  /**
   * @param {?UI.SuggestBox.Suggestion} suggestion
   * @param {boolean=} isIntermediateSuggestion
   */
  applySuggestion(suggestion, isIntermediateSuggestion) {
  }

  /**
   * acceptSuggestion will be always called after call to applySuggestion with isIntermediateSuggestion being equal to false.
   */
  acceptSuggestion() {
  }
}

/**
 * @implements {UI.ListDelegate}
 */
class SuggestBox {
  /**
   * @param {!SuggestBoxDelegate} suggestBoxDelegate
   * @param {number=} maxItemsHeight
   */
  constructor(suggestBoxDelegate, maxItemsHeight) {
    this._suggestBoxDelegate = suggestBoxDelegate;
    this._maxItemsHeight = maxItemsHeight;
    this._rowHeight = 17;
    this._userEnteredText = '';
    this._defaultSelectionIsDimmed = false;

    /** @type {?UI.SuggestBox.Suggestion} */
    this._onlyCompletion = null;

    /** @type {!UI.ListModel<!UI.SuggestBox.Suggestion>} */
    this._items = new UI.ListModel();
    /** @type {!UI.ListControl<!UI.SuggestBox.Suggestion>} */
    this._list = new UI.ListControl(this._items, this, UI.ListMode.EqualHeightItems);
    this._element = this._list.element;
    this._element.classList.add('suggest-box');
    this._element.addEventListener('mousedown', event => event.preventDefault(), true);
    this._element.addEventListener('click', this._onClick.bind(this), false);

    this._glassPane = new UI.GlassPane();
    this._glassPane.setAnchorBehavior(UI.GlassPane.AnchorBehavior.PreferBottom);
    this._glassPane.setOutsideClickCallback(this.hide.bind(this));
    const shadowRoot = UI.createShadowRootWithCoreStyles(this._glassPane.contentElement, 'ui/suggestBox.css');
    shadowRoot.appendChild(this._element);
  }

  /**
   * @return {boolean}
   */
  visible() {
    return this._glassPane.isShowing();
  }

  /**
   * @param {!AnchorBox} anchorBox
   */
  setPosition(anchorBox) {
    this._glassPane.setContentAnchorBox(anchorBox);
  }

  /**
   * @param {!UI.GlassPane.AnchorBehavior} behavior
   */
  setAnchorBehavior(behavior) {
    this._glassPane.setAnchorBehavior(behavior);
  }

  /**
   * @param {!UI.SuggestBox.Suggestions} items
   */
  _updateMaxSize(items) {
    const maxWidth = this._maxWidth(items);
    const length = this._maxItemsHeight ? Math.min(this._maxItemsHeight, items.length) : items.length;
    const maxHeight = length * this._rowHeight;
    this._glassPane.setMaxContentSize(new UI.Size(maxWidth, maxHeight));
  }

  /**
   * @param {!UI.SuggestBox.Suggestions} items
   * @return {number}
   */
  _maxWidth(items) {
    const kMaxWidth = 300;
    if (!items.length) {
      return kMaxWidth;
    }
    let maxItem;
    let maxLength = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const length = (items[i].title || items[i].text).length + (items[i].subtitle || '').length;
      if (length > maxLength) {
        maxLength = length;
        maxItem = items[i];
      }
    }
    const element = this.createElementForItem(/** @type {!UI.SuggestBox.Suggestion} */ (maxItem));
    const preferredWidth =
        UI.measurePreferredSize(element, this._element).width + UI.measuredScrollbarWidth(this._element.ownerDocument);
    return Math.min(kMaxWidth, preferredWidth);
  }

  /**
   * @suppressGlobalPropertiesCheck
   */
  _show() {
    if (this.visible()) {
      return;
    }
    // TODO(dgozman): take document as a parameter.
    this._glassPane.show(document);
    this._rowHeight =
        UI.measurePreferredSize(this.createElementForItem({text: '1', subtitle: '12'}), this._element).height;
  }

  hide() {
    if (!this.visible()) {
      return;
    }
    this._glassPane.hide();
  }

  /**
   * @param {boolean=} isIntermediateSuggestion
   * @return {boolean}
   */
  _applySuggestion(isIntermediateSuggestion) {
    if (this._onlyCompletion) {
      UI.ARIAUtils.alert(ls`${this._onlyCompletion.text}, suggestion`, this._element);
      this._suggestBoxDelegate.applySuggestion(this._onlyCompletion, isIntermediateSuggestion);
      return true;
    }
    const suggestion = this._list.selectedItem();
    if (suggestion && suggestion.text) {
      UI.ARIAUtils.alert(ls`${suggestion.title || suggestion.text}, suggestion`, this._element);
    }
    this._suggestBoxDelegate.applySuggestion(suggestion, isIntermediateSuggestion);

    return this.visible() && !!suggestion;
  }

  /**
   * @return {boolean}
   */
  acceptSuggestion() {
    const result = this._applySuggestion();
    this.hide();
    if (!result) {
      return false;
    }

    this._suggestBoxDelegate.acceptSuggestion();

    return true;
  }

  /**
   * @override
   * @param {!UI.SuggestBox.Suggestion} item
   * @return {!Element}
   */
  createElementForItem(item) {
    const query = this._userEnteredText;
    const element = createElementWithClass('div', 'suggest-box-content-item source-code');
    if (item.iconType) {
      const icon = UI.Icon.create(item.iconType, 'suggestion-icon');
      element.appendChild(icon);
    }
    if (item.isSecondary) {
      element.classList.add('secondary');
    }
    element.tabIndex = -1;
    const maxTextLength = 50 + query.length;
    const displayText = (item.title || item.text).trim().trimEndWithMaxLength(maxTextLength).replace(/\n/g, '\u21B5');

    const titleElement = element.createChild('span', 'suggestion-title');
    const index = displayText.toLowerCase().indexOf(query.toLowerCase());
    if (index > 0) {
      titleElement.createChild('span').textContent = displayText.substring(0, index);
    }
    if (index > -1) {
      titleElement.createChild('span', 'query').textContent = displayText.substring(index, index + query.length);
    }
    titleElement.createChild('span').textContent = displayText.substring(index > -1 ? index + query.length : 0);
    titleElement.createChild('span', 'spacer');
    if (item.subtitleRenderer) {
      const subtitleElement = item.subtitleRenderer.call(null);
      subtitleElement.classList.add('suggestion-subtitle');
      element.appendChild(subtitleElement);
    } else if (item.subtitle) {
      const subtitleElement = element.createChild('span', 'suggestion-subtitle');
      subtitleElement.textContent = item.subtitle.trimEndWithMaxLength(maxTextLength - displayText.length);
    }
    return element;
  }

  /**
   * @override
   * @param {!UI.SuggestBox.Suggestion} item
   * @return {number}
   */
  heightForItem(item) {
    return this._rowHeight;
  }

  /**
   * @override
   * @param {!UI.SuggestBox.Suggestion} item
   * @return {boolean}
   */
  isItemSelectable(item) {
    return true;
  }

  /**
   * @override
   * @param {?UI.SuggestBox.Suggestion} from
   * @param {?UI.SuggestBox.Suggestion} to
   * @param {?Element} fromElement
   * @param {?Element} toElement
   */
  selectedItemChanged(from, to, fromElement, toElement) {
    if (fromElement) {
      fromElement.classList.remove('selected', 'force-white-icons');
    }
    if (toElement) {
      toElement.classList.add('selected');
      toElement.classList.add('force-white-icons');
    }
    this._applySuggestion(true);
  }

  /**
   * @param {!Event} event
   */
  _onClick(event) {
    const item = this._list.itemForNode(/** @type {?Node} */ (event.target));
    if (!item) {
      return;
    }

    this._list.selectItem(item);
    this.acceptSuggestion();
    event.consume(true);
  }

  /**
   * @param {!UI.SuggestBox.Suggestions} completions
   * @param {?UI.SuggestBox.Suggestion} highestPriorityItem
   * @param {boolean} canShowForSingleItem
   * @param {string} userEnteredText
   * @return {boolean}
   */
  _canShowBox(completions, highestPriorityItem, canShowForSingleItem, userEnteredText) {
    if (!completions || !completions.length) {
      return false;
    }

    if (completions.length > 1) {
      return true;
    }

    if (!highestPriorityItem || highestPriorityItem.isSecondary ||
        !highestPriorityItem.text.startsWith(userEnteredText)) {
      return true;
    }

    // Do not show a single suggestion if it is the same as user-entered query, even if allowed to show single-item suggest boxes.
    return canShowForSingleItem && highestPriorityItem.text !== userEnteredText;
  }

  /**
   * @param {!AnchorBox} anchorBox
   * @param {!UI.SuggestBox.Suggestions} completions
   * @param {boolean} selectHighestPriority
   * @param {boolean} canShowForSingleItem
   * @param {string} userEnteredText
   */
  updateSuggestions(anchorBox, completions, selectHighestPriority, canShowForSingleItem, userEnteredText) {
    this._onlyCompletion = null;
    const highestPriorityItem =
        selectHighestPriority ? completions.reduce((a, b) => (a.priority || 0) >= (b.priority || 0) ? a : b) : null;
    if (this._canShowBox(completions, highestPriorityItem, canShowForSingleItem, userEnteredText)) {
      this._userEnteredText = userEnteredText;

      this._show();
      this._updateMaxSize(completions);
      this._glassPane.setContentAnchorBox(anchorBox);
      this._list.invalidateItemHeight();
      this._items.replaceAll(completions);

      if (highestPriorityItem && !highestPriorityItem.isSecondary) {
        this._list.selectItem(highestPriorityItem, true);
      } else {
        this._list.selectItem(null);
      }
    } else {
      if (completions.length === 1) {
        this._onlyCompletion = completions[0];
        this._applySuggestion(true);
      }
      this.hide();
    }
  }

  /**
   * @param {!KeyboardEvent} event
   * @return {boolean}
   */
  keyPressed(event) {
    switch (event.key) {
      case 'Enter':
        return this.enterKeyPressed();
      case 'ArrowUp':
        return this._list.selectPreviousItem(true, false);
      case 'ArrowDown':
        return this._list.selectNextItem(true, false);
      case 'PageUp':
        return this._list.selectItemPreviousPage(false);
      case 'PageDown':
        return this._list.selectItemNextPage(false);
    }
    return false;
  }

  /**
   * @return {boolean}
   */
  enterKeyPressed() {
    const hasSelectedItem = !!this._list.selectedItem() || !!this._onlyCompletion;
    this.acceptSuggestion();

    // Report the event as non-handled if there is no selected item,
    // to commit the input or handle it otherwise.
    return hasSelectedItem;
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SuggestBox = SuggestBox;

/** @interface */
UI.SuggestBoxDelegate = SuggestBoxDelegate;

/**
 * @typedef {{
  *      text: string,
  *      title: (string|undefined),
  *      subtitle: (string|undefined),
  *      iconType: (string|undefined),
  *      priority: (number|undefined),
  *      isSecondary: (boolean|undefined),
  *      subtitleRenderer: (function():!Element|undefined),
  *      selectionRange: ({startColumn: number, endColumn: number}|undefined),
  *      hideGhostText: (boolean|undefined)
  * }}
  */
UI.SuggestBox.Suggestion;

/**
  * @typedef {!Array<!UI.SuggestBox.Suggestion>}
  */
UI.SuggestBox.Suggestions;

var SuggestBox$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  SuggestBoxDelegate: SuggestBoxDelegate,
  'default': SuggestBox
});

/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class SyntaxHighlighter {
  /**
   * @param {string} mimeType
   * @param {boolean} stripExtraWhitespace
   */
  constructor(mimeType, stripExtraWhitespace) {
    this._mimeType = mimeType;
    this._stripExtraWhitespace = stripExtraWhitespace;
  }

  /**
   * @param {string} content
   * @param {string} className
   * @return {!Element}
   */
  createSpan(content, className) {
    const span = createElement('span');
    span.className = className.replace(/\S+/g, 'cm-$&');
    if (this._stripExtraWhitespace && className !== 'whitespace') {
      content = content.replace(/^[\n\r]*/, '').replace(/\s*$/, '');
    }
    span.createTextChild(content);
    return span;
  }

  /**
   * @param {!Element} node
   * @return {!Promise.<undefined>}
   */
  syntaxHighlightNode(node) {
    const lines = node.textContent.split('\n');
    let plainTextStart;
    let line;

    return self.runtime.extension(TextUtils.TokenizerFactory).instance().then(processTokens.bind(this));

    /**
     * @param {!TextUtils.TokenizerFactory} tokenizerFactory
     * @this {SyntaxHighlighter}
     */
    function processTokens(tokenizerFactory) {
      node.removeChildren();
      const tokenize = tokenizerFactory.createTokenizer(this._mimeType);
      for (let i = 0; i < lines.length; ++i) {
        line = lines[i];
        plainTextStart = 0;
        tokenize(line, processToken.bind(this));
        if (plainTextStart < line.length) {
          const plainText = line.substring(plainTextStart, line.length);
          node.createTextChild(plainText);
        }
        if (i < lines.length - 1) {
          node.createTextChild('\n');
        }
      }
    }

    /**
     * @param {string} token
     * @param {?string} tokenType
     * @param {number} column
     * @param {number} newColumn
     * @this {SyntaxHighlighter}
     */
    function processToken(token, tokenType, column, newColumn) {
      if (!tokenType) {
        return;
      }

      if (column > plainTextStart) {
        const plainText = line.substring(plainTextStart, column);
        node.createTextChild(plainText);
      }
      node.appendChild(this.createSpan(token, tokenType));
      plainTextStart = newColumn;
    }
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.SyntaxHighlighter = SyntaxHighlighter;

var SyntaxHighlighter$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': SyntaxHighlighter
});

/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class TabbedPane extends UI.VBox {
  constructor() {
    super(true);
    this.registerRequiredCSS('ui/tabbedPane.css');
    this.element.classList.add('tabbed-pane');
    this.contentElement.classList.add('tabbed-pane-shadow');
    this.contentElement.tabIndex = -1;
    this.setDefaultFocusedElement(this.contentElement);
    this._headerElement = this.contentElement.createChild('div', 'tabbed-pane-header');
    this._headerContentsElement = this._headerElement.createChild('div', 'tabbed-pane-header-contents');
    this._tabSlider = createElementWithClass('div', 'tabbed-pane-tab-slider');
    this._tabsElement = this._headerContentsElement.createChild('div', 'tabbed-pane-header-tabs');
    this._tabsElement.setAttribute('role', 'tablist');
    this._tabsElement.addEventListener('keydown', this._keyDown.bind(this), false);
    this._contentElement = this.contentElement.createChild('div', 'tabbed-pane-content');
    this._contentElement.setAttribute('role', 'tabpanel');
    this._contentElement.createChild('slot');
    /** @type {!Array.<!TabbedPaneTab>} */
    this._tabs = [];
    /** @type {!Array.<!TabbedPaneTab>} */
    this._tabsHistory = [];
    /** @type {!Map<string, !TabbedPaneTab>} */
    this._tabsById = new Map();
    this._currentTabLocked = false;
    this._autoSelectFirstItemOnShow = true;

    this._triggerDropDownTimeout = null;
    this._dropDownButton = this._createDropDownButton();
    UI.zoomManager.addEventListener(UI.ZoomManager.Events.ZoomChanged, this._zoomChanged, this);
    this.makeTabSlider();
  }

  /**
   * @param {string} name
   */
  setAccessibleName(name) {
    UI.ARIAUtils.setAccessibleName(this._tabsElement, name);
  }

  /**
   * @param {boolean} locked
   */
  setCurrentTabLocked(locked) {
    this._currentTabLocked = locked;
    this._headerElement.classList.toggle('locked', this._currentTabLocked);
  }

  /**
   * @param {boolean} autoSelect
   */
  setAutoSelectFirstItemOnShow(autoSelect) {
    this._autoSelectFirstItemOnShow = autoSelect;
  }

  /**
   * @return {?UI.Widget}
   */
  get visibleView() {
    return this._currentTab ? this._currentTab.view : null;
  }

  /**
   * @return {!Array.<string>}
   */
  tabIds() {
    return this._tabs.map(tab => tab._id);
  }

  /**
   * @param {string} tabId
   * @return {number}
   */
  tabIndex(tabId) {
    return this._tabs.findIndex(tab => tab.id === tabId);
  }

  /**
   * @return {!Array.<!UI.Widget>}
   */
  tabViews() {
    return this._tabs.map(tab => tab.view);
  }

  /**
   * @param {string} tabId
   * @return {?UI.Widget}
   */
  tabView(tabId) {
    return this._tabsById.has(tabId) ? this._tabsById.get(tabId).view : null;
  }

  /**
   * @return {?string}
   */
  get selectedTabId() {
    return this._currentTab ? this._currentTab.id : null;
  }

  /**
   * @param {boolean} shrinkableTabs
   */
  setShrinkableTabs(shrinkableTabs) {
    this._shrinkableTabs = shrinkableTabs;
  }

  makeVerticalTabLayout() {
    this._verticalTabLayout = true;
    this._setTabSlider(false);
    this.contentElement.classList.add('vertical-tab-layout');
    this.invalidateConstraints();
  }

  /**
   * @param {boolean} closeableTabs
   */
  setCloseableTabs(closeableTabs) {
    this._closeableTabs = closeableTabs;
  }

  /**
   * @override
   */
  focus() {
    if (this.visibleView) {
      this.visibleView.focus();
    } else {
      this._defaultFocusedElement.focus(); /** _defaultFocusedElement defined in Widget.js */
    }
  }

  /**
   * @return {!Element}
   */
  headerElement() {
    return this._headerElement;
  }

  /**
   * @param {string} id
   * @return {boolean}
   */
  isTabCloseable(id) {
    const tab = this._tabsById.get(id);
    return tab ? tab.isCloseable() : false;
  }

  /**
   * @param {!TabbedPaneTabDelegate} delegate
   */
  setTabDelegate(delegate) {
    const tabs = this._tabs.slice();
    for (let i = 0; i < tabs.length; ++i) {
      tabs[i].setDelegate(delegate);
    }
    this._delegate = delegate;
  }

  /**
   * @param {string} id
   * @param {string} tabTitle
   * @param {!UI.Widget} view
   * @param {string=} tabTooltip
   * @param {boolean=} userGesture
   * @param {boolean=} isCloseable
   * @param {number=} index
   */
  appendTab(id, tabTitle, view, tabTooltip, userGesture, isCloseable, index) {
    isCloseable = typeof isCloseable === 'boolean' ? isCloseable : this._closeableTabs;
    const tab = new TabbedPaneTab(this, id, tabTitle, isCloseable, view, tabTooltip);
    tab.setDelegate(this._delegate);
    console.assert(!this._tabsById.has(id), `Tabbed pane already contains a tab with id '${id}'`);
    this._tabsById.set(id, tab);
    if (index !== undefined) {
      this._tabs.splice(index, 0, tab);
    } else {
      this._tabs.push(tab);
    }
    this._tabsHistory.push(tab);
    if (this._tabsHistory[0] === tab && this.isShowing()) {
      this.selectTab(tab.id, userGesture);
    }
    this._updateTabElements();
  }

  /**
   * @param {string} id
   * @param {boolean=} userGesture
   */
  closeTab(id, userGesture) {
    this.closeTabs([id], userGesture);
  }


  /**
   * @param {!Array.<string>} ids
   * @param {boolean=} userGesture
   */
  closeTabs(ids, userGesture) {
    const focused = this.hasFocus();
    for (let i = 0; i < ids.length; ++i) {
      this._innerCloseTab(ids[i], userGesture);
    }
    this._updateTabElements();
    if (this._tabsHistory.length) {
      this.selectTab(this._tabsHistory[0].id, false);
    }
    if (focused) {
      this.focus();
    }
  }

  /**
   * @param {string} id
   * @param {boolean=} userGesture
   */
  _innerCloseTab(id, userGesture) {
    if (!this._tabsById.has(id)) {
      return;
    }
    if (userGesture && !this._tabsById.get(id)._closeable) {
      return;
    }
    if (this._currentTab && this._currentTab.id === id) {
      this._hideCurrentTab();
    }

    const tab = this._tabsById.get(id);
    this._tabsById.delete(id);

    this._tabsHistory.splice(this._tabsHistory.indexOf(tab), 1);
    this._tabs.splice(this._tabs.indexOf(tab), 1);
    if (tab._shown) {
      this._hideTabElement(tab);
    }

    const eventData = {tabId: id, view: tab.view, isUserGesture: userGesture};
    this.dispatchEventToListeners(Events$4.TabClosed, eventData);
    return true;
  }

  /**
   * @param {string} tabId
   * @return {boolean}
   */
  hasTab(tabId) {
    return this._tabsById.has(tabId);
  }

  /**
   * @param {string} id
   * @return {!Array.<string>}
   */
  otherTabs(id) {
    const result = [];
    for (let i = 0; i < this._tabs.length; ++i) {
      if (this._tabs[i].id !== id) {
        result.push(this._tabs[i].id);
      }
    }
    return result;
  }

  /**
   * @param {string} id
   * @return {!Array.<string>}
   */
  _tabsToTheRight(id) {
    let index = -1;
    for (let i = 0; i < this._tabs.length; ++i) {
      if (this._tabs[i].id === id) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return [];
    }
    return this._tabs.slice(index + 1).map(function(tab) {
      return tab.id;
    });
  }

  _viewHasFocus() {
    if (this.visibleView && this.visibleView.hasFocus()) {
      return true;
    }
    return this.contentElement === this.contentElement.getComponentRoot().activeElement;
  }

  /**
   * @param {string} id
   * @param {boolean=} userGesture
   * @param {boolean=} forceFocus
   * @return {boolean}
   */
  selectTab(id, userGesture, forceFocus) {
    if (this._currentTabLocked) {
      return false;
    }
    const focused = this._viewHasFocus();
    const tab = this._tabsById.get(id);
    if (!tab) {
      return false;
    }
    if (this._currentTab && this._currentTab.id === id) {
      return true;
    }

    this.suspendInvalidations();
    this._hideCurrentTab();
    this._showTab(tab);
    this.resumeInvalidations();
    this._currentTab = tab;

    this._tabsHistory.splice(this._tabsHistory.indexOf(tab), 1);
    this._tabsHistory.splice(0, 0, tab);

    this._updateTabElements();
    if (focused || forceFocus) {
      this.focus();
    }

    const eventData = {tabId: id, view: tab.view, isUserGesture: userGesture};
    this.dispatchEventToListeners(Events$4.TabSelected, eventData);
    return true;
  }

  selectNextTab() {
    const index = this._tabs.indexOf(this._currentTab);
    const nextIndex = mod(index + 1, this._tabs.length);
    this.selectTab(this._tabs[nextIndex].id, true);
  }

  selectPrevTab() {
    const index = this._tabs.indexOf(this._currentTab);
    const nextIndex = mod(index - 1, this._tabs.length);
    this.selectTab(this._tabs[nextIndex].id, true);
  }

  /**
   * @param {number} tabsCount
   * @return {!Array.<string>}
   */
  lastOpenedTabIds(tabsCount) {
    function tabToTabId(tab) {
      return tab.id;
    }

    return this._tabsHistory.slice(0, tabsCount).map(tabToTabId);
  }

  /**
   * @param {string} id
   * @param {?UI.Icon} icon
   */
  setTabIcon(id, icon) {
    const tab = this._tabsById.get(id);
    tab._setIcon(icon);
    this._updateTabElements();
  }

  /**
   * @param {string} id
   * @param {boolean} enabled
   */
  setTabEnabled(id, enabled) {
    const tab = this._tabsById.get(id);
    tab.tabElement.classList.toggle('disabled', !enabled);
  }

  /**
   * @param {string} id
   * @param {string} className
   * @param {boolean=} force
   */
  toggleTabClass(id, className, force) {
    const tab = this._tabsById.get(id);
    if (tab._toggleClass(className, force)) {
      this._updateTabElements();
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _zoomChanged(event) {
    for (let i = 0; i < this._tabs.length; ++i) {
      delete this._tabs[i]._measuredWidth;
    }
    if (this.isShowing()) {
      this._updateTabElements();
    }
  }

  /**
   * @param {string} id
   * @param {string} tabTitle
   * @param {string=} tabTooltip
   */
  changeTabTitle(id, tabTitle, tabTooltip) {
    const tab = this._tabsById.get(id);
    if (tabTooltip !== undefined) {
      tab.tooltip = tabTooltip;
    }
    if (tab.title !== tabTitle) {
      tab.title = tabTitle;
      UI.ARIAUtils.setAccessibleName(tab.tabElement, tabTitle);
      this._updateTabElements();
    }
  }

  /**
   * @param {string} id
   * @param {!UI.Widget} view
   */
  changeTabView(id, view) {
    const tab = this._tabsById.get(id);
    if (tab.view === view) {
      return;
    }

    this.suspendInvalidations();
    const isSelected = this._currentTab && this._currentTab.id === id;
    const shouldFocus = tab.view.hasFocus();
    if (isSelected) {
      this._hideTab(tab);
    }
    tab.view = view;
    if (isSelected) {
      this._showTab(tab);
    }
    if (shouldFocus) {
      tab.view.focus();
    }
    this.resumeInvalidations();
  }

  /**
   * @override
   */
  onResize() {
    this._updateTabElements();
  }

  headerResized() {
    this._updateTabElements();
  }

  /**
   * @override
   */
  wasShown() {
    const effectiveTab = this._currentTab || this._tabsHistory[0];
    if (effectiveTab && this._autoSelectFirstItemOnShow) {
      this.selectTab(effectiveTab.id);
    }
  }

  makeTabSlider() {
    if (this._verticalTabLayout) {
      return;
    }
    this._setTabSlider(true);
  }

  /**
   * @param {boolean} enable
   */
  _setTabSlider(enable) {
    this._sliderEnabled = enable;
    this._tabSlider.classList.toggle('enabled', enable);
  }

  /**
   * @override
   * @return {!UI.Constraints}
   */
  calculateConstraints() {
    let constraints = super.calculateConstraints();
    const minContentConstraints = new UI.Constraints(new UI.Size(0, 0), new UI.Size(50, 50));
    constraints = constraints.widthToMax(minContentConstraints).heightToMax(minContentConstraints);
    if (this._verticalTabLayout) {
      constraints = constraints.addWidth(new UI.Constraints(new UI.Size(120, 0)));
    } else {
      constraints = constraints.addHeight(new UI.Constraints(new UI.Size(0, 30)));
    }
    return constraints;
  }

  _updateTabElements() {
    UI.invokeOnceAfterBatchUpdate(this, this._innerUpdateTabElements);
  }

  /**
   * @param {!Element} element
   * @param {!Element=} focusedElement
   */
  setPlaceholderElement(element, focusedElement) {
    this._placeholderElement = element;
    if (focusedElement) {
      this._focusedPlaceholderElement = focusedElement;
    }
    if (this._placeholderContainerElement) {
      this._placeholderContainerElement.removeChildren();
      this._placeholderContainerElement.appendChild(element);
    }
  }

  _innerUpdateTabElements() {
    if (!this.isShowing()) {
      return;
    }

    if (!this._tabs.length) {
      this._contentElement.classList.add('has-no-tabs');
      if (this._placeholderElement && !this._placeholderContainerElement) {
        this._placeholderContainerElement = this._contentElement.createChild('div', 'tabbed-pane-placeholder fill');
        this._placeholderContainerElement.appendChild(this._placeholderElement);
        if (this._focusedPlaceholderElement) {
          this.setDefaultFocusedElement(this._focusedPlaceholderElement);
          this.focus();
        }
      }
    } else {
      this._contentElement.classList.remove('has-no-tabs');
      if (this._placeholderContainerElement) {
        this._placeholderContainerElement.remove();
        this.setDefaultFocusedElement(this.contentElement);
        delete this._placeholderContainerElement;
      }
    }

    this._measureDropDownButton();
    this._updateWidths();
    this._updateTabsDropDown();
    this._updateTabSlider();
  }

  /**
   * @param {number} index
   * @param {!TabbedPaneTab} tab
   */
  _showTabElement(index, tab) {
    if (index >= this._tabsElement.children.length) {
      this._tabsElement.appendChild(tab.tabElement);
    } else {
      this._tabsElement.insertBefore(tab.tabElement, this._tabsElement.children[index]);
    }
    tab._shown = true;
  }

  /**
   * @param {!TabbedPaneTab} tab
   */
  _hideTabElement(tab) {
    this._tabsElement.removeChild(tab.tabElement);
    tab._shown = false;
  }

  _createDropDownButton() {
    const dropDownContainer = createElementWithClass('div', 'tabbed-pane-header-tabs-drop-down-container');
    const chevronIcon = UI.Icon.create('largeicon-chevron', 'chevron-icon');
    UI.ARIAUtils.markAsMenuButton(dropDownContainer);
    UI.ARIAUtils.setAccessibleName(dropDownContainer, ls`More tabs`);
    dropDownContainer.tabIndex = 0;
    dropDownContainer.appendChild(chevronIcon);
    dropDownContainer.addEventListener('click', this._dropDownClicked.bind(this));
    dropDownContainer.addEventListener('keydown', this._dropDownKeydown.bind(this));
    dropDownContainer.addEventListener('mousedown', event => {
      if (event.which !== 1 || this._triggerDropDownTimeout) {
        return;
      }
      this._triggerDropDownTimeout = setTimeout(this._dropDownClicked.bind(this, event), 200);
    });
    return dropDownContainer;
  }

  /**
   * @param {!Event} event
   */
  _dropDownClicked(event) {
    if (event.which !== 1) {
      return;
    }
    if (this._triggerDropDownTimeout) {
      clearTimeout(this._triggerDropDownTimeout);
      this._triggerDropDownTimeout = null;
    }
    const rect = this._dropDownButton.getBoundingClientRect();
    const menu = new UI.ContextMenu(event, false, rect.left, rect.bottom);
    for (let i = 0; i < this._tabs.length; ++i) {
      const tab = this._tabs[i];
      if (tab._shown) {
        continue;
      }
      menu.defaultSection().appendCheckboxItem(
          tab.title, this._dropDownMenuItemSelected.bind(this, tab), this._tabsHistory[0] === tab);
    }
    menu.show();
  }

  /**
   * @param {!Event} event
   */
  _dropDownKeydown(event) {
    if (isEnterOrSpaceKey(event)) {
      this._dropDownButton.click();
      event.consume(true);
    }
  }

  /**
   * @param {!TabbedPaneTab} tab
   */
  _dropDownMenuItemSelected(tab) {
    this._lastSelectedOverflowTab = tab;
    this.selectTab(tab.id, true, true);
  }

  _totalWidth() {
    return this._headerContentsElement.getBoundingClientRect().width;
  }

  /**
   * @return {number}
   */
  _numberOfTabsShown() {
    let numTabsShown = 0;
    for (const tab of this._tabs) {
      if (tab._shown) {
        numTabsShown++;
      }
    }
    return numTabsShown;
  }

  disableOverflowMenu() {
    this._overflowDisabled = true;
  }

  _updateTabsDropDown() {
    const tabsToShowIndexes = this._tabsToShowIndexes(
        this._tabs, this._tabsHistory, this._totalWidth(), this._measuredDropDownButtonWidth || 0);
    if (this._lastSelectedOverflowTab && this._numberOfTabsShown() !== tabsToShowIndexes.length) {
      delete this._lastSelectedOverflowTab;
      this._updateTabsDropDown();
      return;
    }

    for (let i = 0; i < this._tabs.length; ++i) {
      if (this._tabs[i]._shown && tabsToShowIndexes.indexOf(i) === -1) {
        this._hideTabElement(this._tabs[i]);
      }
    }
    for (let i = 0; i < tabsToShowIndexes.length; ++i) {
      const tab = this._tabs[tabsToShowIndexes[i]];
      if (!tab._shown) {
        this._showTabElement(i, tab);
      }
    }

    if (!this._overflowDisabled) {
      this._maybeShowDropDown(tabsToShowIndexes.length !== this._tabs.length);
    }
  }

  /**
   * @param {boolean} hasMoreTabs
   */
  _maybeShowDropDown(hasMoreTabs) {
    if (hasMoreTabs && !this._dropDownButton.parentElement) {
      this._headerContentsElement.appendChild(this._dropDownButton);
    } else if (!hasMoreTabs && this._dropDownButton.parentElement) {
      this._headerContentsElement.removeChild(this._dropDownButton);
    }
  }

  _measureDropDownButton() {
    if (this._overflowDisabled || this._measuredDropDownButtonWidth) {
      return;
    }
    this._dropDownButton.classList.add('measuring');
    this._headerContentsElement.appendChild(this._dropDownButton);
    this._measuredDropDownButtonWidth = this._dropDownButton.getBoundingClientRect().width;
    this._headerContentsElement.removeChild(this._dropDownButton);
    this._dropDownButton.classList.remove('measuring');
  }

  _updateWidths() {
    const measuredWidths = this._measureWidths();
    const maxWidth =
        this._shrinkableTabs ? this._calculateMaxWidth(measuredWidths.slice(), this._totalWidth()) : Number.MAX_VALUE;

    let i = 0;
    for (const tab of this._tabs) {
      tab.setWidth(this._verticalTabLayout ? -1 : Math.min(maxWidth, measuredWidths[i++]));
    }
  }

  _measureWidths() {
    // Add all elements to measure into this._tabsElement
    this._tabsElement.style.setProperty('width', '2000px');
    const measuringTabElements = [];
    for (const tab of this._tabs) {
      if (typeof tab._measuredWidth === 'number') {
        continue;
      }
      const measuringTabElement = tab._createTabElement(true);
      measuringTabElement.__tab = tab;
      measuringTabElements.push(measuringTabElement);
      this._tabsElement.appendChild(measuringTabElement);
    }

    // Perform measurement
    for (let i = 0; i < measuringTabElements.length; ++i) {
      const width = measuringTabElements[i].getBoundingClientRect().width;
      measuringTabElements[i].__tab._measuredWidth = Math.ceil(width);
    }

    // Nuke elements from the UI
    for (let i = 0; i < measuringTabElements.length; ++i) {
      measuringTabElements[i].remove();
    }

    // Combine the results.
    const measuredWidths = [];
    for (const tab of this._tabs) {
      measuredWidths.push(tab._measuredWidth);
    }
    this._tabsElement.style.removeProperty('width');

    return measuredWidths;
  }

  /**
   * @param {!Array.<number>} measuredWidths
   * @param {number} totalWidth
   */
  _calculateMaxWidth(measuredWidths, totalWidth) {
    if (!measuredWidths.length) {
      return 0;
    }

    measuredWidths.sort(function(x, y) {
      return x - y;
    });

    let totalMeasuredWidth = 0;
    for (let i = 0; i < measuredWidths.length; ++i) {
      totalMeasuredWidth += measuredWidths[i];
    }

    if (totalWidth >= totalMeasuredWidth) {
      return measuredWidths[measuredWidths.length - 1];
    }

    let totalExtraWidth = 0;
    for (let i = measuredWidths.length - 1; i > 0; --i) {
      const extraWidth = measuredWidths[i] - measuredWidths[i - 1];
      totalExtraWidth += (measuredWidths.length - i) * extraWidth;

      if (totalWidth + totalExtraWidth >= totalMeasuredWidth) {
        return measuredWidths[i - 1] +
            (totalWidth + totalExtraWidth - totalMeasuredWidth) / (measuredWidths.length - i);
      }
    }

    return totalWidth / measuredWidths.length;
  }

  /**
   * @param {!Array.<!TabbedPaneTab>} tabsOrdered
   * @param {!Array.<!TabbedPaneTab>} tabsHistory
   * @param {number} totalWidth
   * @param {number} measuredDropDownButtonWidth
   * @return {!Array.<number>}
   */
  _tabsToShowIndexes(tabsOrdered, tabsHistory, totalWidth, measuredDropDownButtonWidth) {
    const tabsToShowIndexes = [];

    let totalTabsWidth = 0;
    const tabCount = tabsOrdered.length;
    const tabsToLookAt = tabsOrdered.slice(0);
    if (this._currentTab !== undefined) {
      tabsToLookAt.unshift(tabsToLookAt.splice(tabsToLookAt.indexOf(this._currentTab), 1)[0]);
    }
    if (this._lastSelectedOverflowTab !== undefined) {
      tabsToLookAt.unshift(tabsToLookAt.splice(tabsToLookAt.indexOf(this._lastSelectedOverflowTab), 1)[0]);
    }
    for (let i = 0; i < tabCount; ++i) {
      const tab = this._automaticReorder ? tabsHistory[i] : tabsToLookAt[i];
      totalTabsWidth += tab.width();
      let minimalRequiredWidth = totalTabsWidth;
      if (i !== tabCount - 1) {
        minimalRequiredWidth += measuredDropDownButtonWidth;
      }
      if (!this._verticalTabLayout && minimalRequiredWidth > totalWidth) {
        break;
      }
      tabsToShowIndexes.push(tabsOrdered.indexOf(tab));
    }

    tabsToShowIndexes.sort(function(x, y) {
      return x - y;
    });

    return tabsToShowIndexes;
  }

  _hideCurrentTab() {
    if (!this._currentTab) {
      return;
    }

    this._hideTab(this._currentTab);
    delete this._currentTab;
  }

  /**
   * @param {!TabbedPaneTab} tab
   */
  _showTab(tab) {
    tab.tabElement.tabIndex = 0;
    tab.tabElement.classList.add('selected');
    UI.ARIAUtils.setSelected(tab.tabElement, true);
    tab.view.show(this.element);
    this._updateTabSlider();
  }

  _updateTabSlider() {
    if (!this._sliderEnabled) {
      return;
    }
    if (!this._currentTab) {
      this._tabSlider.style.width = 0;
      return;
    }
    let left = 0;
    for (let i = 0; i < this._tabs.length && this._currentTab !== this._tabs[i]; i++) {
      if (this._tabs[i]._shown) {
        left += this._tabs[i]._measuredWidth;
      }
    }
    const sliderWidth = this._currentTab._shown ? this._currentTab._measuredWidth : this._dropDownButton.offsetWidth;
    const scaleFactor = window.devicePixelRatio >= 1.5 ? ' scaleY(0.75)' : '';
    this._tabSlider.style.transform = 'translateX(' + left + 'px)' + scaleFactor;
    this._tabSlider.style.width = sliderWidth + 'px';

    if (this._tabSlider.parentElement !== this._headerContentsElement) {
      this._headerContentsElement.appendChild(this._tabSlider);
    }
  }

  /**
   * @param {!TabbedPaneTab} tab
   */
  _hideTab(tab) {
    tab.tabElement.removeAttribute('tabIndex');
    tab.tabElement.classList.remove('selected');
    tab.tabElement.setAttribute('aria-selected', 'false');
    tab.view.detach();
  }

  /**
   * @override
   * @return {!Array.<!Element>}
   */
  elementsToRestoreScrollPositionsFor() {
    return [this._contentElement];
  }

  /**
   * @param {!TabbedPaneTab} tab
   * @param {number} index
   */
  _insertBefore(tab, index) {
    this._tabsElement.insertBefore(tab.tabElement, this._tabsElement.childNodes[index]);
    const oldIndex = this._tabs.indexOf(tab);
    this._tabs.splice(oldIndex, 1);
    if (oldIndex < index) {
      --index;
    }
    this._tabs.splice(index, 0, tab);
    this.dispatchEventToListeners(Events$4.TabOrderChanged, {tabId: tab.id});
  }

  /**
   * @return {!UI.Toolbar}
   */
  leftToolbar() {
    if (!this._leftToolbar) {
      this._leftToolbar = new UI.Toolbar('tabbed-pane-left-toolbar');
      this._headerElement.insertBefore(this._leftToolbar.element, this._headerElement.firstChild);
    }
    return this._leftToolbar;
  }

  /**
   * @return {!UI.Toolbar}
   */
  rightToolbar() {
    if (!this._rightToolbar) {
      this._rightToolbar = new UI.Toolbar('tabbed-pane-right-toolbar');
      this._headerElement.appendChild(this._rightToolbar.element);
    }
    return this._rightToolbar;
  }

  /**
   * @param {boolean} allow
   * @param {boolean=} automatic
   */
  setAllowTabReorder(allow, automatic) {
    this._allowTabReorder = allow;
    this._automaticReorder = automatic;
  }

  /**
   * @param {!Event} event
   */
  _keyDown(event) {
    if (!this._currentTab) {
      return;
    }
    let nextTabElement = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        nextTabElement = this._currentTab.tabElement.previousElementSibling;
        if (!nextTabElement && !this._dropDownButton.parentElement) {
          nextTabElement = this._currentTab.tabElement.parentElement.lastElementChild;
        }
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        nextTabElement = this._currentTab.tabElement.nextElementSibling;
        if (!nextTabElement && !this._dropDownButton.parentElement) {
          nextTabElement = this._currentTab.tabElement.parentElement.firstElementChild;
        }
        break;
      case 'Enter':
      case ' ':
        this._currentTab.view.focus();
        return;
      default:
        return;
    }
    if (!nextTabElement) {
      this._dropDownButton.click();
      return;
    }
    const tab = this._tabs.find(tab => tab.tabElement === nextTabElement);
    this.selectTab(tab.id, true);
    nextTabElement.focus();
  }
}

/** @enum {symbol} */
const Events$4 = {
  TabSelected: Symbol('TabSelected'),
  TabClosed: Symbol('TabClosed'),
  TabOrderChanged: Symbol('TabOrderChanged')
};

/**
 * @unrestricted
 */
class TabbedPaneTab {
  /**
   * @param {!UI.TabbedPane} tabbedPane
   * @param {string} id
   * @param {string} title
   * @param {boolean} closeable
   * @param {!UI.Widget} view
   * @param {string=} tooltip
   */
  constructor(tabbedPane, id, title, closeable, view, tooltip) {
    this._closeable = closeable;
    this._tabbedPane = tabbedPane;
    this._id = id;
    this._title = title;
    this._tooltip = tooltip;
    this._view = view;
    this._shown = false;
    /** @type {number} */
    this._measuredWidth;
    /** @type {!Element|undefined} */
    this._tabElement;
    /** @type {?Element} */
    this._iconContainer = null;
  }

  /**
   * @return {string}
   */
  get id() {
    return this._id;
  }

  /**
   * @return {string}
   */
  get title() {
    return this._title;
  }

  /**
   * @param {string} title
   */
  set title(title) {
    if (title === this._title) {
      return;
    }
    this._title = title;
    if (this._titleElement) {
      this._titleElement.textContent = title;
    }
    delete this._measuredWidth;
  }

  /**
   * @return {boolean}
   */
  isCloseable() {
    return this._closeable;
  }

  /**
   * @param {?UI.Icon} icon
   */
  _setIcon(icon) {
    this._icon = icon;
    if (this._tabElement) {
      this._createIconElement(this._tabElement, this._titleElement, false);
    }
    delete this._measuredWidth;
  }

  /**
   * @param {string} className
   * @param {boolean=} force
   * @return {boolean}
   */
  _toggleClass(className, force) {
    const element = this.tabElement;
    const hasClass = element.classList.contains(className);
    if (hasClass === force) {
      return false;
    }
    element.classList.toggle(className, force);
    delete this._measuredWidth;
    return true;
  }

  /**
   * @return {!UI.Widget}
   */
  get view() {
    return this._view;
  }

  /**
   * @param {!UI.Widget} view
   */
  set view(view) {
    this._view = view;
  }

  /**
   * @return {string|undefined}
   */
  get tooltip() {
    return this._tooltip;
  }

  /**
   * @param {string|undefined} tooltip
   */
  set tooltip(tooltip) {
    this._tooltip = tooltip;
    if (this._titleElement) {
      this._titleElement.title = tooltip || '';
    }
  }

  /**
   * @return {!Element}
   */
  get tabElement() {
    if (!this._tabElement) {
      this._tabElement = this._createTabElement(false);
    }

    return this._tabElement;
  }

  /**
   * @return {number}
   */
  width() {
    return this._width;
  }

  /**
   * @param {number} width
   */
  setWidth(width) {
    this.tabElement.style.width = width === -1 ? '' : (width + 'px');
    this._width = width;
  }

  /**
   * @param {!TabbedPaneTabDelegate} delegate
   */
  setDelegate(delegate) {
    this._delegate = delegate;
  }

  /**
   * @param {!Element} tabElement
   * @param {!Element} titleElement
   * @param {boolean} measuring
   */
  _createIconElement(tabElement, titleElement, measuring) {
    if (tabElement.__iconElement) {
      tabElement.__iconElement.remove();
      tabElement.__iconElement = null;
    }
    if (!this._icon) {
      return;
    }

    const iconContainer = createElementWithClass('span', 'tabbed-pane-header-tab-icon');
    const iconNode = measuring ? this._icon.cloneNode(true) : this._icon;
    iconContainer.appendChild(iconNode);
    tabElement.insertBefore(iconContainer, titleElement);
    tabElement.__iconElement = iconContainer;
  }

  /**
   * @param {boolean} measuring
   * @return {!Element}
   */
  _createTabElement(measuring) {
    const tabElement = createElementWithClass('div', 'tabbed-pane-header-tab');
    tabElement.id = 'tab-' + this._id;
    UI.ARIAUtils.markAsTab(tabElement);
    UI.ARIAUtils.setSelected(tabElement, false);
    UI.ARIAUtils.setAccessibleName(tabElement, this.title);

    const titleElement = tabElement.createChild('span', 'tabbed-pane-header-tab-title');
    titleElement.textContent = this.title;
    titleElement.title = this.tooltip || '';
    this._createIconElement(tabElement, titleElement, measuring);
    if (!measuring) {
      this._titleElement = titleElement;
    }

    if (this._closeable) {
      const closeButton = tabElement.createChild('div', 'tabbed-pane-close-button', 'dt-close-button');
      closeButton.gray = true;
      closeButton.setAccessibleName(ls`Close ${this.title}`);
      tabElement.classList.add('closeable');
    }

    if (measuring) {
      tabElement.classList.add('measuring');
    } else {
      tabElement.addEventListener('click', this._tabClicked.bind(this), false);
      tabElement.addEventListener('auxclick', this._tabClicked.bind(this), false);
      tabElement.addEventListener('mousedown', this._tabMouseDown.bind(this), false);
      tabElement.addEventListener('mouseup', this._tabMouseUp.bind(this), false);

      tabElement.addEventListener('contextmenu', this._tabContextMenu.bind(this), false);
      if (this._tabbedPane._allowTabReorder) {
        UI.installDragHandle(
            tabElement, this._startTabDragging.bind(this), this._tabDragging.bind(this),
            this._endTabDragging.bind(this), '-webkit-grabbing', 'pointer', 200);
      }
    }

    return tabElement;
  }

  /**
   * @param {!Event} event
   */
  _tabClicked(event) {
    const middleButton = event.button === 1;
    const shouldClose =
        this._closeable && (middleButton || event.target.classList.contains('tabbed-pane-close-button'));
    if (!shouldClose) {
      this._tabbedPane.focus();
      return;
    }
    this._closeTabs([this.id]);
    event.consume(true);
  }

  /**
   * @param {!Event} event
   */
  _tabMouseDown(event) {
    if (event.target.classList.contains('tabbed-pane-close-button') || event.button === 1) {
      return;
    }
    this._tabbedPane.selectTab(this.id, true);
  }

  /**
   * @param {!Event} event
   */
  _tabMouseUp(event) {
    // This is needed to prevent middle-click pasting on linux when tabs are clicked.
    if (event.button === 1) {
      event.consume(true);
    }
  }

  /**
   * @param {!Array.<string>} ids
   */
  _closeTabs(ids) {
    if (this._delegate) {
      this._delegate.closeTabs(this._tabbedPane, ids);
      return;
    }
    this._tabbedPane.closeTabs(ids, true);
  }

  _tabContextMenu(event) {
    /**
     * @this {TabbedPaneTab}
     */
    function close() {
      this._closeTabs([this.id]);
    }

    /**
     * @this {TabbedPaneTab}
     */
    function closeOthers() {
      this._closeTabs(this._tabbedPane.otherTabs(this.id));
    }

    /**
     * @this {TabbedPaneTab}
     */
    function closeAll() {
      this._closeTabs(this._tabbedPane.tabIds());
    }

    /**
     * @this {TabbedPaneTab}
     */
    function closeToTheRight() {
      this._closeTabs(this._tabbedPane._tabsToTheRight(this.id));
    }

    const contextMenu = new UI.ContextMenu(event);
    if (this._closeable) {
      contextMenu.defaultSection().appendItem(Common.UIString('Close'), close.bind(this));
      contextMenu.defaultSection().appendItem(Common.UIString('Close others'), closeOthers.bind(this));
      contextMenu.defaultSection().appendItem(Common.UIString('Close tabs to the right'), closeToTheRight.bind(this));
      contextMenu.defaultSection().appendItem(Common.UIString('Close all'), closeAll.bind(this));
    }
    if (this._delegate) {
      this._delegate.onContextMenu(this.id, contextMenu);
    }
    contextMenu.show();
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  _startTabDragging(event) {
    if (event.target.classList.contains('tabbed-pane-close-button')) {
      return false;
    }
    this._dragStartX = event.pageX;
    this._tabElement.classList.add('dragging');
    this._tabbedPane._tabSlider.remove();
    return true;
  }

  /**
   * @param {!Event} event
   */
  _tabDragging(event) {
    const tabElements = this._tabbedPane._tabsElement.childNodes;
    for (let i = 0; i < tabElements.length; ++i) {
      let tabElement = tabElements[i];
      if (tabElement === this._tabElement) {
        continue;
      }

      const intersects = tabElement.offsetLeft + tabElement.clientWidth > this._tabElement.offsetLeft &&
          this._tabElement.offsetLeft + this._tabElement.clientWidth > tabElement.offsetLeft;
      if (!intersects) {
        continue;
      }

      if (Math.abs(event.pageX - this._dragStartX) < tabElement.clientWidth / 2 + 5) {
        break;
      }

      if (event.pageX - this._dragStartX > 0) {
        tabElement = tabElement.nextSibling;
        ++i;
      }

      const oldOffsetLeft = this._tabElement.offsetLeft;
      this._tabbedPane._insertBefore(this, i);
      this._dragStartX += this._tabElement.offsetLeft - oldOffsetLeft;
      break;
    }

    if (!this._tabElement.previousSibling && event.pageX - this._dragStartX < 0) {
      this._tabElement.style.setProperty('left', '0px');
      return;
    }
    if (!this._tabElement.nextSibling && event.pageX - this._dragStartX > 0) {
      this._tabElement.style.setProperty('left', '0px');
      return;
    }

    this._tabElement.style.setProperty('left', (event.pageX - this._dragStartX) + 'px');
  }

  /**
   * @param {!Event} event
   */
  _endTabDragging(event) {
    this._tabElement.classList.remove('dragging');
    this._tabElement.style.removeProperty('left');
    delete this._dragStartX;
    this._tabbedPane._updateTabSlider();
  }
}

/**
 * @interface
 */
class TabbedPaneTabDelegate {
  /**
   * @param {!UI.TabbedPane} tabbedPane
   * @param {!Array.<string>} ids
   */
  closeTabs(tabbedPane, ids) {
  }

  /**
   * @param {string} tabId
   * @param {!UI.ContextMenu} contextMenu
   */
  onContextMenu(tabId, contextMenu) {}
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.TabbedPane = TabbedPane;

/** @enum {symbol} */
UI.TabbedPane.Events = Events$4;

/** @constructor */
UI.TabbedPaneTab = TabbedPaneTab;

/** @interface */
UI.TabbedPaneTabDelegate = TabbedPaneTabDelegate;

var TabbedPane$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': TabbedPane,
  Events: Events$4,
  TabbedPaneTab: TabbedPaneTab,
  TabbedPaneTabDelegate: TabbedPaneTabDelegate
});

// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class TargetCrashedScreen extends UI.VBox {
  /**
   * @param {function()} hideCallback
   */
  constructor(hideCallback) {
    super(true);
    this.registerRequiredCSS('ui/targetCrashedScreen.css');
    this.contentElement.createChild('div', 'message').textContent =
        Common.UIString('DevTools was disconnected from the page.');
    this.contentElement.createChild('div', 'message').textContent =
        Common.UIString('Once page is reloaded, DevTools will automatically reconnect.');
    this._hideCallback = hideCallback;
  }

  /**
   * @override
   */
  willHide() {
    this._hideCallback.call(null);
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.TargetCrashedScreen = TargetCrashedScreen;

var TargetCrashedScreen$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': TargetCrashedScreen
});

// Copyright 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @interface
 */
class TextEditorFactory {
  /**
   * @param {!UI.TextEditor.Options} options
   * @return {!TextEditor}
   */
  createEditor(options) {}
}

/**
 * @interface
 */
class TextEditor extends Common.EventTarget {
  /**
   * @return {!UI.Widget}
   */
  widget() {
  }

  /**
   * @return {!TextUtils.TextRange}
   */
  fullRange() {
  }

  /**
   * @return {!TextUtils.TextRange}
   */
  selection() {
  }

  /**
   * @param {!TextUtils.TextRange} selection
   */
  setSelection(selection) {
  }

  /**
   * @param {!TextUtils.TextRange=} textRange
   * @return {string}
   */
  text(textRange) {
  }

  /**
   * @return {string}
   */
  textWithCurrentSuggestion() {
  }

  /**
   * @param {string} text
   */
  setText(text) {
  }

  /**
   * @param {number} lineNumber
   * @return {string}
   */
  line(lineNumber) {
  }

  newlineAndIndent() {
  }

  /**
   * @param {function(!KeyboardEvent)} handler
   */
  addKeyDownHandler(handler) {
  }

  /**
   * @param {?UI.AutocompleteConfig} config
   */
  configureAutocomplete(config) {
  }

  clearAutocomplete() {
  }

  /**
   * @param {number} lineNumber
   * @param {number} columnNumber
   * @return {!{x: number, y: number}}
   */
  visualCoordinates(lineNumber, columnNumber) {
  }

  /**
   * @param {number} lineNumber
   * @param {number} columnNumber
   * @return {?{startColumn: number, endColumn: number, type: string}}
   */
  tokenAtTextPosition(lineNumber, columnNumber) {
  }

  /**
   * @param {string} placeholder
   */
  setPlaceholder(placeholder) {}
}

/** @enum {symbol} */
const Events$3 = {
  CursorChanged: Symbol('CursorChanged'),
  TextChanged: Symbol('TextChanged'),
  SuggestionChanged: Symbol('SuggestionChanged')
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @interface */
UI.TextEditor = TextEditor;

/** @interface */
UI.TextEditorFactory = TextEditorFactory;

/** @enum {symbol} */
UI.TextEditor.Events = Events$3;

/**
 * @typedef {{
  *  bracketMatchingSetting: (!Common.Setting|undefined),
  *  devtoolsAccessibleName: (string|undefined),
  *  lineNumbers: boolean,
  *  lineWrapping: boolean,
  *  mimeType: (string|undefined),
  *  autoHeight: (boolean|undefined),
  *  padBottom: (boolean|undefined),
  *  maxHighlightLength: (number|undefined),
  *  placeholder: (string|undefined)
  * }}
  */
UI.TextEditor.Options;

/**
  * @typedef {{
  *     substituteRangeCallback: ((function(number, number):?TextUtils.TextRange)|undefined),
  *     tooltipCallback: ((function(number, number):!Promise<?Element>)|undefined),
  *     suggestionsCallback: ((function(!TextUtils.TextRange, !TextUtils.TextRange, boolean=):?Promise.<!UI.SuggestBox.Suggestions>)|undefined),
  *     isWordChar: ((function(string):boolean)|undefined),
  *     anchorBehavior: (UI.GlassPane.AnchorBehavior|undefined)
  * }}
  */
UI.AutocompleteConfig;

var TextEditor$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  TextEditorFactory: TextEditorFactory,
  TextEditor: TextEditor,
  Events: Events$3
});

/*
 * Copyright (C) 2008 Apple Inc.  All rights reserved.
 * Copyright (C) 2011 Google Inc.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
/**
 * @implements {UI.SuggestBoxDelegate}
 * @unrestricted
 */
class TextPrompt extends Common.Object {
  constructor() {
    super();
    /**
     * @type {!Element|undefined}
     */
    this._proxyElement;
    this._proxyElementDisplay = 'inline-block';
    this._autocompletionTimeout = DefaultAutocompletionTimeout;
    this._title = '';
    this._queryRange = null;
    this._previousText = '';
    this._currentSuggestion = null;
    this._completionRequestId = 0;
    this._ghostTextElement = createElementWithClass('span', 'auto-complete-text');
    this._ghostTextElement.setAttribute('contenteditable', 'false');
    UI.ARIAUtils.markAsHidden(this._ghostTextElement);
  }

  /**
   * @param {(function(this:null, string, string, boolean=):!Promise<!UI.SuggestBox.Suggestions>)} completions
   * @param {string=} stopCharacters
   */
  initialize(completions, stopCharacters) {
    this._loadCompletions = completions;
    this._completionStopCharacters = stopCharacters || ' =:[({;,!+-*/&|^<>.';
  }

  /**
   * @param {number} timeout
   */
  setAutocompletionTimeout(timeout) {
    this._autocompletionTimeout = timeout;
  }

  renderAsBlock() {
    this._proxyElementDisplay = 'block';
  }

  /**
   * Clients should never attach any event listeners to the |element|. Instead,
   * they should use the result of this method to attach listeners for bubbling events.
   *
   * @param {!Element} element
   * @return {!Element}
   */
  attach(element) {
    return this._attachInternal(element);
  }

  /**
   * Clients should never attach any event listeners to the |element|. Instead,
   * they should use the result of this method to attach listeners for bubbling events
   * or the |blurListener| parameter to register a "blur" event listener on the |element|
   * (since the "blur" event does not bubble.)
   *
   * @param {!Element} element
   * @param {function(!Event)} blurListener
   * @return {!Element}
   */
  attachAndStartEditing(element, blurListener) {
    const proxyElement = this._attachInternal(element);
    this._startEditing(blurListener);
    return proxyElement;
  }

  /**
   * @param {!Element} element
   * @return {!Element}
   */
  _attachInternal(element) {
    if (this._proxyElement) {
      throw 'Cannot attach an attached TextPrompt';
    }
    this._element = element;

    this._boundOnKeyDown = this.onKeyDown.bind(this);
    this._boundOnInput = this.onInput.bind(this);
    this._boundOnMouseWheel = this.onMouseWheel.bind(this);
    this._boundClearAutocomplete = this.clearAutocomplete.bind(this);
    this._proxyElement = element.ownerDocument.createElement('span');
    UI.appendStyle(this._proxyElement, 'ui/textPrompt.css');
    this._contentElement = this._proxyElement.createChild('div', 'text-prompt-root');
    this._proxyElement.style.display = this._proxyElementDisplay;
    element.parentElement.insertBefore(this._proxyElement, element);
    this._contentElement.appendChild(element);
    this._element.classList.add('text-prompt');
    UI.ARIAUtils.markAsTextBox(this._element);
    this._element.setAttribute('contenteditable', 'plaintext-only');
    this._element.addEventListener('keydown', this._boundOnKeyDown, false);
    this._element.addEventListener('input', this._boundOnInput, false);
    this._element.addEventListener('mousewheel', this._boundOnMouseWheel, false);
    this._element.addEventListener('selectstart', this._boundClearAutocomplete, false);
    this._element.addEventListener('blur', this._boundClearAutocomplete, false);

    this._suggestBox = new UI.SuggestBox(this, 20);

    if (this._title) {
      this._proxyElement.title = this._title;
    }

    return this._proxyElement;
  }

  detach() {
    this._removeFromElement();
    this._focusRestorer.restore();
    this._proxyElement.parentElement.insertBefore(this._element, this._proxyElement);
    this._proxyElement.remove();
    delete this._proxyElement;
    this._element.classList.remove('text-prompt');
    this._element.removeAttribute('contenteditable');
    this._element.removeAttribute('role');
  }

  /**
   * @return {string}
   */
  textWithCurrentSuggestion() {
    const text = this.text();
    if (!this._queryRange || !this._currentSuggestion) {
      return text;
    }
    const suggestion = this._currentSuggestion.text;
    return text.substring(0, this._queryRange.startColumn) + suggestion + text.substring(this._queryRange.endColumn);
  }

  /**
   * @return {string}
   */
  text() {
    let text = this._element.textContent;
    if (this._ghostTextElement.parentNode) {
      const addition = this._ghostTextElement.textContent;
      text = text.substring(0, text.length - addition.length);
    }
    return text;
  }

  /**
   * @param {string} text
   */
  setText(text) {
    this.clearAutocomplete();
    this._element.textContent = text;
    this._previousText = this.text();
    if (this._element.hasFocus()) {
      this.moveCaretToEndOfPrompt();
      this._element.scrollIntoView();
    }
  }

  focus() {
    this._element.focus();
  }

  /**
   * @return {string}
   */
  title() {
    return this._title;
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    this._title = title;
    if (this._proxyElement) {
      this._proxyElement.title = title;
    }
  }

  /**
   * @param {string} placeholder
   * @param {string=} ariaPlaceholder
   */
  setPlaceholder(placeholder, ariaPlaceholder) {
    if (placeholder) {
      this._element.setAttribute('data-placeholder', placeholder);
      // TODO(https://github.com/nvaccess/nvda/issues/10164): Remove ariaPlaceholder once the NVDA bug is fixed
      // ariaPlaceholder and placeholder may differ, like in case the placeholder contains a '?'
      UI.ARIAUtils.setPlaceholder(this._element, ariaPlaceholder || placeholder);
    } else {
      this._element.removeAttribute('data-placeholder');
      UI.ARIAUtils.setPlaceholder(this._element, null);
    }
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    if (enabled) {
      this._element.setAttribute('contenteditable', 'plaintext-only');
    } else {
      this._element.removeAttribute('contenteditable');
    }
    this._element.classList.toggle('disabled', !enabled);
  }

  _removeFromElement() {
    this.clearAutocomplete();
    this._element.removeEventListener('keydown', this._boundOnKeyDown, false);
    this._element.removeEventListener('input', this._boundOnInput, false);
    this._element.removeEventListener('selectstart', this._boundClearAutocomplete, false);
    this._element.removeEventListener('blur', this._boundClearAutocomplete, false);
    if (this._isEditing) {
      this._stopEditing();
    }
    if (this._suggestBox) {
      this._suggestBox.hide();
    }
  }

  /**
   * @param {function(!Event)=} blurListener
   */
  _startEditing(blurListener) {
    this._isEditing = true;
    this._contentElement.classList.add('text-prompt-editing');
    if (blurListener) {
      this._blurListener = blurListener;
      this._element.addEventListener('blur', this._blurListener, false);
    }
    this._oldTabIndex = this._element.tabIndex;
    if (this._element.tabIndex < 0) {
      this._element.tabIndex = 0;
    }
    this._focusRestorer = new UI.ElementFocusRestorer(this._element);
    if (!this.text()) {
      this.autoCompleteSoon();
    }
  }

  _stopEditing() {
    this._element.tabIndex = this._oldTabIndex;
    if (this._blurListener) {
      this._element.removeEventListener('blur', this._blurListener, false);
    }
    this._contentElement.classList.remove('text-prompt-editing');
    delete this._isEditing;
  }

  /**
   * @param {!Event} event
   */
  onMouseWheel(event) {
    // Subclasses can implement.
  }

  /**
   * @param {!Event} event
   */
  onKeyDown(event) {
    let handled = false;
    if (this.isSuggestBoxVisible() && this._suggestBox.keyPressed(event)) {
      event.consume(true);
      return;
    }

    switch (event.key) {
      case 'Tab':
        handled = this.tabKeyPressed(event);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Home':
        this.clearAutocomplete();
        break;
      case 'PageDown':
      case 'ArrowRight':
      case 'ArrowDown':
      case 'End':
        if (this._isCaretAtEndOfPrompt()) {
          handled = this.acceptAutoComplete();
        } else {
          this.clearAutocomplete();
        }
        break;
      case 'Escape':
        if (this.isSuggestBoxVisible()) {
          this.clearAutocomplete();
          handled = true;
        }
        break;
      case ' ':  // Space
        if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          this.autoCompleteSoon(true);
          handled = true;
        }
        break;
    }

    if (isEnterKey(event)) {
      event.preventDefault();
    }

    if (handled) {
      event.consume(true);
    }
  }

  /**
   * @param {string} key
   * @return {boolean}
   */
  _acceptSuggestionOnStopCharacters(key) {
    if (!this._currentSuggestion || !this._queryRange || key.length !== 1 ||
        !this._completionStopCharacters.includes(key)) {
      return false;
    }

    const query = this.text().substring(this._queryRange.startColumn, this._queryRange.endColumn);
    if (query && this._currentSuggestion.text.startsWith(query + key)) {
      this._queryRange.endColumn += 1;
      return this.acceptAutoComplete();
    }
    return false;
  }

  /**
   * @param {!Event} event
   */
  onInput(event) {
    const text = this.text();
    if (event.data && !this._acceptSuggestionOnStopCharacters(event.data)) {
      const hasCommonPrefix = text.startsWith(this._previousText) || this._previousText.startsWith(text);
      if (this._queryRange && hasCommonPrefix) {
        this._queryRange.endColumn += text.length - this._previousText.length;
      }
    }
    this._refreshGhostText();
    this._previousText = text;
    this.dispatchEventToListeners(Events$2.TextChanged);

    this.autoCompleteSoon();
  }

  /**
   * @return {boolean}
   */
  acceptAutoComplete() {
    let result = false;
    if (this.isSuggestBoxVisible()) {
      result = this._suggestBox.acceptSuggestion();
    }
    if (!result) {
      result = this._acceptSuggestionInternal();
    }

    return result;
  }

  clearAutocomplete() {
    const beforeText = this.textWithCurrentSuggestion();

    if (this.isSuggestBoxVisible()) {
      this._suggestBox.hide();
    }
    this._clearAutocompleteTimeout();
    this._queryRange = null;
    this._refreshGhostText();

    if (beforeText !== this.textWithCurrentSuggestion()) {
      this.dispatchEventToListeners(Events$2.TextChanged);
    }
  }

  _refreshGhostText() {
    if (this._currentSuggestion && this._currentSuggestion.hideGhostText) {
      this._ghostTextElement.remove();
      return;
    }
    if (this._queryRange && this._currentSuggestion && this._isCaretAtEndOfPrompt() &&
        this._currentSuggestion.text.startsWith(this.text().substring(this._queryRange.startColumn))) {
      this._ghostTextElement.textContent =
          this._currentSuggestion.text.substring(this._queryRange.endColumn - this._queryRange.startColumn);
      this._element.appendChild(this._ghostTextElement);
    } else {
      this._ghostTextElement.remove();
    }
  }

  _clearAutocompleteTimeout() {
    if (this._completeTimeout) {
      clearTimeout(this._completeTimeout);
      delete this._completeTimeout;
    }
    this._completionRequestId++;
  }

  /**
   * @param {boolean=} force
   */
  autoCompleteSoon(force) {
    const immediately = this.isSuggestBoxVisible() || force;
    if (!this._completeTimeout) {
      this._completeTimeout =
          setTimeout(this.complete.bind(this, force), immediately ? 0 : this._autocompletionTimeout);
    }
  }

  /**
   * @param {boolean=} force
   */
  async complete(force) {
    this._clearAutocompleteTimeout();
    const selection = this._element.getComponentSelection();
    const selectionRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!selectionRange) {
      return;
    }

    let shouldExit;

    if (!force && !this._isCaretAtEndOfPrompt() && !this.isSuggestBoxVisible()) {
      shouldExit = true;
    } else if (!selection.isCollapsed) {
      shouldExit = true;
    }

    if (shouldExit) {
      this.clearAutocomplete();
      return;
    }

    const wordQueryRange = selectionRange.startContainer.rangeOfWord(
        selectionRange.startOffset, this._completionStopCharacters, this._element, 'backward');

    const expressionRange = wordQueryRange.cloneRange();
    expressionRange.collapse(true);
    expressionRange.setStartBefore(this._element);
    const completionRequestId = ++this._completionRequestId;
    const completions = await this._loadCompletions(expressionRange.toString(), wordQueryRange.toString(), !!force);
    this._completionsReady(completionRequestId, selection, wordQueryRange, !!force, completions);
  }

  disableDefaultSuggestionForEmptyInput() {
    this._disableDefaultSuggestionForEmptyInput = true;
  }

  /**
   * @param {!Selection} selection
   * @param {!Range} textRange
   */
  _boxForAnchorAtStart(selection, textRange) {
    const rangeCopy = selection.getRangeAt(0).cloneRange();
    const anchorElement = createElement('span');
    anchorElement.textContent = '\u200B';
    textRange.insertNode(anchorElement);
    const box = anchorElement.boxInWindow(window);
    anchorElement.remove();
    selection.removeAllRanges();
    selection.addRange(rangeCopy);
    return box;
  }

  /**
   * @return {?Range}
   * @suppressGlobalPropertiesCheck
   */
  _createRange() {
    return document.createRange();
  }

  /**
   * @param {string} query
   * @return {!UI.SuggestBox.Suggestions}
   */
  additionalCompletions(query) {
    return [];
  }

  /**
   * @param {number} completionRequestId
   * @param {!Selection} selection
   * @param {!Range} originalWordQueryRange
   * @param {boolean} force
   * @param {!UI.SuggestBox.Suggestions} completions
   */
  _completionsReady(completionRequestId, selection, originalWordQueryRange, force, completions) {
    if (this._completionRequestId !== completionRequestId) {
      return;
    }

    const query = originalWordQueryRange.toString();

    // Filter out dupes.
    const store = new Set();
    completions = completions.filter(item => !store.has(item.text) && !!store.add(item.text));

    if (query || force) {
      if (query) {
        completions = completions.concat(this.additionalCompletions(query));
      } else {
        completions = this.additionalCompletions(query).concat(completions);
      }
    }

    if (!completions.length) {
      this.clearAutocomplete();
      return;
    }

    const selectionRange = selection.getRangeAt(0);

    const fullWordRange = this._createRange();
    fullWordRange.setStart(originalWordQueryRange.startContainer, originalWordQueryRange.startOffset);
    fullWordRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);

    if (query + selectionRange.toString() !== fullWordRange.toString()) {
      return;
    }

    const beforeRange = this._createRange();
    beforeRange.setStart(this._element, 0);
    beforeRange.setEnd(fullWordRange.startContainer, fullWordRange.startOffset);
    this._queryRange = new TextUtils.TextRange(
        0, beforeRange.toString().length, 0, beforeRange.toString().length + fullWordRange.toString().length);

    const shouldSelect = !this._disableDefaultSuggestionForEmptyInput || !!this.text();
    if (this._suggestBox) {
      this._suggestBox.updateSuggestions(
          this._boxForAnchorAtStart(selection, fullWordRange), completions, shouldSelect, !this._isCaretAtEndOfPrompt(),
          this.text());
    }
  }

  /**
   * @override
   * @param {?UI.SuggestBox.Suggestion} suggestion
   * @param {boolean=} isIntermediateSuggestion
   */
  applySuggestion(suggestion, isIntermediateSuggestion) {
    this._currentSuggestion = suggestion;
    this._refreshGhostText();
    if (isIntermediateSuggestion) {
      this.dispatchEventToListeners(Events$2.TextChanged);
    }
  }

  /**
   * @override
   */
  acceptSuggestion() {
    this._acceptSuggestionInternal();
  }

  /**
   * @return {boolean}
   */
  _acceptSuggestionInternal() {
    if (!this._queryRange) {
      return false;
    }

    const suggestionLength = this._currentSuggestion ? this._currentSuggestion.text.length : 0;
    const selectionRange = this._currentSuggestion ? this._currentSuggestion.selectionRange : null;
    const endColumn = selectionRange ? selectionRange.endColumn : suggestionLength;
    const startColumn = selectionRange ? selectionRange.startColumn : suggestionLength;
    this._element.textContent = this.textWithCurrentSuggestion();
    this.setDOMSelection(this._queryRange.startColumn + startColumn, this._queryRange.startColumn + endColumn);

    this.clearAutocomplete();
    this.dispatchEventToListeners(Events$2.TextChanged);

    return true;
  }

  /**
   * @param {number} startColumn
   * @param {number} endColumn
   */
  setDOMSelection(startColumn, endColumn) {
    this._element.normalize();
    const node = this._element.childNodes[0];
    if (!node || node === this._ghostTextElement) {
      return;
    }
    const range = this._createRange();
    range.setStart(node, startColumn);
    range.setEnd(node, endColumn);
    const selection = this._element.getComponentSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * @protected
   * @return {boolean}
   */
  isSuggestBoxVisible() {
    return this._suggestBox && this._suggestBox.visible();
  }

  /**
   * @return {boolean}
   */
  isCaretInsidePrompt() {
    const selection = this._element.getComponentSelection();
    // @see crbug.com/602541
    const selectionRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!selectionRange || !selection.isCollapsed) {
      return false;
    }
    return selectionRange.startContainer.isSelfOrDescendant(this._element);
  }

  /**
   * @return {boolean}
   */
  _isCaretAtEndOfPrompt() {
    const selection = this._element.getComponentSelection();
    const selectionRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!selectionRange || !selection.isCollapsed) {
      return false;
    }

    let node = selectionRange.startContainer;
    if (!node.isSelfOrDescendant(this._element)) {
      return false;
    }

    if (this._ghostTextElement.isAncestor(node)) {
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE && selectionRange.startOffset < node.nodeValue.length) {
      return false;
    }

    let foundNextText = false;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.length) {
        if (foundNextText && !this._ghostTextElement.isAncestor(node)) {
          return false;
        }
        foundNextText = true;
      }

      node = node.traverseNextNode(this._element);
    }

    return true;
  }

  moveCaretToEndOfPrompt() {
    const selection = this._element.getComponentSelection();
    const selectionRange = this._createRange();

    let container = this._element;
    while (container.childNodes.length) {
      container = container.lastChild;
    }
    const offset = container.nodeType === Node.TEXT_NODE ? container.textContent.length : 0;
    selectionRange.setStart(container, offset);
    selectionRange.setEnd(container, offset);

    selection.removeAllRanges();
    selection.addRange(selectionRange);
  }

  /**
   * @param {!Event} event
   * @return {boolean}
   */
  tabKeyPressed(event) {
    return this.acceptAutoComplete();
  }

  /**
   * @return {?Element}
   */
  proxyElementForTests() {
    return this._proxyElement || null;
  }
}

const DefaultAutocompletionTimeout = 250;

/** @enum {symbol} */
const Events$2 = {
  TextChanged: Symbol('TextChanged')
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.TextPrompt = TextPrompt;

UI.TextPrompt.DefaultAutocompletionTimeout = DefaultAutocompletionTimeout;

/** @enum {symbol} */
UI.TextPrompt.Events = Events$2;

var TextPrompt$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': TextPrompt,
  DefaultAutocompletionTimeout: DefaultAutocompletionTimeout,
  Events: Events$2
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ThrottledWidget extends UI.VBox {
  /**
   * @param {boolean=} isWebComponent
   * @param {number=} timeout
   */
  constructor(isWebComponent, timeout) {
    super(isWebComponent);
    this._updateThrottler = new Common.Throttler(timeout === undefined ? 100 : timeout);
    this._updateWhenVisible = false;
  }

  /**
   * @protected
   * @return {!Promise<?>}
   */
  doUpdate() {
    return Promise.resolve();
  }

  update() {
    this._updateWhenVisible = !this.isShowing();
    if (this._updateWhenVisible) {
      return;
    }
    this._updateThrottler.schedule(innerUpdate.bind(this));

    /**
     * @this {ThrottledWidget}
     * @return {!Promise<?>}
     */
    function innerUpdate() {
      if (this.isShowing()) {
        return this.doUpdate();
      }
      this._updateWhenVisible = true;
      return Promise.resolve();
    }
  }

  /**
   * @override
   */
  wasShown() {
    super.wasShown();
    if (this._updateWhenVisible) {
      this.update();
    }
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ThrottledWidget = ThrottledWidget;

var ThrottledWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ThrottledWidget
});

/*
 * Copyright (C) 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class Toolbar {
  /**
   * @param {string} className
   * @param {!Element=} parentElement
   */
  constructor(className, parentElement) {
    /** @type {!Array.<!ToolbarItem>} */
    this._items = [];
    this.element = parentElement ? parentElement.createChild('div') : createElement('div');
    this.element.className = className;
    this.element.classList.add('toolbar');
    this._enabled = true;
    this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, 'ui/toolbar.css');
    this._contentElement = this._shadowRoot.createChild('div', 'toolbar-shadow');
    this._insertionPoint = this._contentElement.createChild('slot');
  }

  /**
   * @param {!UI.Action} action
   * @param {!Array<!ToolbarButton>} toggledOptions
   * @param {!Array<!ToolbarButton>} untoggledOptions
   * @return {!ToolbarButton}
   */
  static createLongPressActionButton(action, toggledOptions, untoggledOptions) {
    const button = UI.Toolbar.createActionButton(action);
    const mainButtonClone = UI.Toolbar.createActionButton(action);

    /** @type {?UI.LongClickController} */
    let longClickController = null;
    /** @type {?Array<!ToolbarButton>} */
    let longClickButtons = null;
    /** @type {?Element} */
    let longClickGlyph = null;

    action.addEventListener(UI.Action.Events.Toggled, updateOptions);
    updateOptions();
    return button;

    function updateOptions() {
      const buttons = action.toggled() ? (toggledOptions || null) : (untoggledOptions || null);

      if (buttons && buttons.length) {
        if (!longClickController) {
          longClickController = new UI.LongClickController(button.element, showOptions);
          longClickGlyph = UI.Icon.create('largeicon-longclick-triangle', 'long-click-glyph');
          button.element.appendChild(longClickGlyph);
          longClickButtons = buttons;
        }
      } else {
        if (longClickController) {
          longClickController.dispose();
          longClickController = null;
          longClickGlyph.remove();
          longClickGlyph = null;
          longClickButtons = null;
        }
      }
    }

    function showOptions() {
      let buttons = longClickButtons.slice();
      buttons.push(mainButtonClone);

      const document = button.element.ownerDocument;
      document.documentElement.addEventListener('mouseup', mouseUp, false);

      const optionsGlassPane = new UI.GlassPane();
      optionsGlassPane.setPointerEventsBehavior(UI.GlassPane.PointerEventsBehavior.BlockedByGlassPane);
      optionsGlassPane.show(document);
      const optionsBar = new UI.Toolbar('fill', optionsGlassPane.contentElement);
      optionsBar._contentElement.classList.add('floating');
      const buttonHeight = 26;

      const hostButtonPosition = button.element.boxInWindow().relativeToElement(UI.GlassPane.container(document));

      const topNotBottom = hostButtonPosition.y + buttonHeight * buttons.length < document.documentElement.offsetHeight;

      if (topNotBottom) {
        buttons = buttons.reverse();
      }

      optionsBar.element.style.height = (buttonHeight * buttons.length) + 'px';
      if (topNotBottom) {
        optionsBar.element.style.top = (hostButtonPosition.y - 5) + 'px';
      } else {
        optionsBar.element.style.top = (hostButtonPosition.y - (buttonHeight * (buttons.length - 1)) - 6) + 'px';
      }
      optionsBar.element.style.left = (hostButtonPosition.x - 5) + 'px';

      for (let i = 0; i < buttons.length; ++i) {
        buttons[i].element.addEventListener('mousemove', mouseOver, false);
        buttons[i].element.addEventListener('mouseout', mouseOut, false);
        optionsBar.appendToolbarItem(buttons[i]);
      }
      const hostButtonIndex = topNotBottom ? 0 : buttons.length - 1;
      buttons[hostButtonIndex].element.classList.add('emulate-active');

      function mouseOver(e) {
        if (e.which !== 1) {
          return;
        }
        const buttonElement = e.target.enclosingNodeOrSelfWithClass('toolbar-item');
        buttonElement.classList.add('emulate-active');
      }

      function mouseOut(e) {
        if (e.which !== 1) {
          return;
        }
        const buttonElement = e.target.enclosingNodeOrSelfWithClass('toolbar-item');
        buttonElement.classList.remove('emulate-active');
      }

      function mouseUp(e) {
        if (e.which !== 1) {
          return;
        }
        optionsGlassPane.hide();
        document.documentElement.removeEventListener('mouseup', mouseUp, false);

        for (let i = 0; i < buttons.length; ++i) {
          if (buttons[i].element.classList.contains('emulate-active')) {
            buttons[i].element.classList.remove('emulate-active');
            buttons[i]._clicked(e);
            break;
          }
        }
      }
    }
  }

  /**
   * @param {!UI.Action} action
   * @param {boolean=} showLabel
   * @return {!ToolbarButton}
   */
  static createActionButton(action, showLabel) {
    const button = action.toggleable() ? makeToggle() : makeButton();

    if (showLabel) {
      button.setText(action.title());
    }
    button.addEventListener(ToolbarButton.Events.Click, action.execute, action);
    action.addEventListener(UI.Action.Events.Enabled, enabledChanged);
    button.setEnabled(action.enabled());
    return button;

    /**
     * @return {!ToolbarButton}
     */

    function makeButton() {
      const button = new ToolbarButton(action.title(), action.icon());
      if (action.title()) {
        UI.Tooltip.install(button.element, action.title(), action.id());
      }
      return button;
    }

    /**
     * @return {!ToolbarToggle}
     */
    function makeToggle() {
      const toggleButton = new ToolbarToggle(action.title(), action.icon(), action.toggledIcon());
      toggleButton.setToggleWithRedColor(action.toggleWithRedColor());
      action.addEventListener(UI.Action.Events.Toggled, toggled);
      toggled();
      return toggleButton;

      function toggled() {
        toggleButton.setToggled(action.toggled());
        if (action.title()) {
          UI.Tooltip.install(toggleButton.element, action.title(), action.id());
        }
      }
    }

    /**
     * @param {!Common.Event} event
     */
    function enabledChanged(event) {
      button.setEnabled(/** @type {boolean} */ (event.data));
    }
  }

  /**
   * @param {string} actionId
   * @param {boolean=} showLabel
   * @return {!ToolbarButton}
   */
  static createActionButtonForId(actionId, showLabel) {
    const action = UI.actionRegistry.action(actionId);
    return UI.Toolbar.createActionButton(/** @type {!UI.Action} */ (action), showLabel);
  }

  /**
   * @return {!Element}
   */
  gripElementForResize() {
    return this._contentElement;
  }

  /**
   * @param {boolean=} growVertically
   */
  makeWrappable(growVertically) {
    this._contentElement.classList.add('wrappable');
    if (growVertically) {
      this._contentElement.classList.add('toolbar-grow-vertical');
    }
  }

  makeVertical() {
    this._contentElement.classList.add('vertical');
  }

  makeBlueOnHover() {
    this._contentElement.classList.add('toolbar-blue-on-hover');
  }

  makeToggledGray() {
    this._contentElement.classList.add('toolbar-toggled-gray');
  }

  renderAsLinks() {
    this._contentElement.classList.add('toolbar-render-as-links');
  }

  /**
   * @return {boolean}
   */
  empty() {
    return !this._items.length;
  }

  /**
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
    for (const item of this._items) {
      item._applyEnabledState(this._enabled && item._enabled);
    }
  }

  /**
   * @param {!ToolbarItem} item
   */
  appendToolbarItem(item) {
    this._items.push(item);
    item._toolbar = this;
    if (!this._enabled) {
      item._applyEnabledState(false);
    }
    this._contentElement.insertBefore(item.element, this._insertionPoint);
    this._hideSeparatorDupes();
  }

  appendSeparator() {
    this.appendToolbarItem(new ToolbarSeparator());
  }

  appendSpacer() {
    this.appendToolbarItem(new ToolbarSeparator(true));
  }

  /**
   * @param {string} text
   */
  appendText(text) {
    this.appendToolbarItem(new ToolbarText(text));
  }

  removeToolbarItems() {
    for (const item of this._items) {
      delete item._toolbar;
    }
    this._items = [];
    this._contentElement.removeChildren();
    this._insertionPoint = this._contentElement.createChild('slot');
  }

  /**
   * @param {string} color
   */
  setColor(color) {
    const style = createElement('style');
    style.textContent = '.toolbar-glyph { background-color: ' + color + ' !important }';
    this._shadowRoot.appendChild(style);
  }

  /**
   * @param {string} color
   */
  setToggledColor(color) {
    const style = createElement('style');
    style.textContent =
        '.toolbar-button.toolbar-state-on .toolbar-glyph { background-color: ' + color + ' !important }';
    this._shadowRoot.appendChild(style);
  }

  _hideSeparatorDupes() {
    if (!this._items.length) {
      return;
    }
    // Don't hide first and last separators if they were added explicitly.
    let previousIsSeparator = false;
    let lastSeparator;
    let nonSeparatorVisible = false;
    for (let i = 0; i < this._items.length; ++i) {
      if (this._items[i] instanceof ToolbarSeparator) {
        this._items[i].setVisible(!previousIsSeparator);
        previousIsSeparator = true;
        lastSeparator = this._items[i];
        continue;
      }
      if (this._items[i].visible()) {
        previousIsSeparator = false;
        lastSeparator = null;
        nonSeparatorVisible = true;
      }
    }
    if (lastSeparator && lastSeparator !== this._items.peekLast()) {
      lastSeparator.setVisible(false);
    }

    this.element.classList.toggle('hidden', !!lastSeparator && lastSeparator.visible() && !nonSeparatorVisible);
  }

  /**
   * @param {string} location
   * @return {!Promise}
   */
  async appendItemsAtLocation(location) {
    const extensions = self.runtime.extensions(Provider);
    const filtered = extensions.filter(e => e.descriptor()['location'] === location);
    const items = await Promise.all(filtered.map(extension => {
      const descriptor = extension.descriptor();
      if (descriptor['separator']) {
        return new ToolbarSeparator();
      }
      if (descriptor['actionId']) {
        return UI.Toolbar.createActionButtonForId(descriptor['actionId'], descriptor['showLabel']);
      }
      return extension.instance().then(p => p.item());
    }));
    items.filter(item => item).forEach(item => this.appendToolbarItem(item));
  }
}

/**
 * @unrestricted
 */
class ToolbarItem extends Common.Object {
  /**
   * @param {!Element} element
   */
  constructor(element) {
    super();
    this.element = element;
    this.element.classList.add('toolbar-item');
    this._visible = true;
    this._enabled = true;
  }

  /**
   * @param {string} title
   */
  setTitle(title) {
    if (this._title === title) {
      return;
    }
    this._title = title;
    UI.ARIAUtils.setAccessibleName(this.element, title);
    UI.Tooltip.install(this.element, title);
  }

  /**
   * @param {boolean} value
   */
  setEnabled(value) {
    if (this._enabled === value) {
      return;
    }
    this._enabled = value;
    this._applyEnabledState(this._enabled && (!this._toolbar || this._toolbar._enabled));
  }

  /**
   * @param {boolean} enabled
   */
  _applyEnabledState(enabled) {
    this.element.disabled = !enabled;
  }

  /**
   * @return {boolean} x
   */
  visible() {
    return this._visible;
  }

  /**
   * @param {boolean} x
   */
  setVisible(x) {
    if (this._visible === x) {
      return;
    }
    this.element.classList.toggle('hidden', !x);
    this._visible = x;
    if (this._toolbar && !(this instanceof ToolbarSeparator)) {
      this._toolbar._hideSeparatorDupes();
    }
  }

  setRightAligned(alignRight) {
    this.element.classList.toggle('toolbar-item-right-aligned', alignRight);
  }
}

/**
 * @unrestricted
 */
class ToolbarText extends ToolbarItem {
  /**
   * @param {string=} text
   */
  constructor(text) {
    super(createElementWithClass('div', 'toolbar-text'));
    this.element.classList.add('toolbar-text');
    this.setText(text || '');
  }

  /**
   * @return {string}
   */
  text() {
    return this.element.textContent;
  }

  /**
   * @param {string} text
   */
  setText(text) {
    this.element.textContent = text;
  }
}

/**
 * @unrestricted
 */
class ToolbarButton extends ToolbarItem {
  /**
   * @param {string} title
   * @param {string=} glyph
   * @param {string=} text
   */
  constructor(title, glyph, text) {
    super(createElementWithClass('button', 'toolbar-button'));
    this.element.addEventListener('click', this._clicked.bind(this), false);
    this.element.addEventListener('mousedown', this._mouseDown.bind(this), false);
    this.element.addEventListener('keydown', this._keydown.bind(this), false);

    this._glyphElement = UI.Icon.create('', 'toolbar-glyph hidden');
    this.element.appendChild(this._glyphElement);
    this._textElement = this.element.createChild('div', 'toolbar-text hidden');

    this.setTitle(title);
    if (glyph) {
      this.setGlyph(glyph);
    }
    this.setText(text || '');
    this._title = '';
  }

  /**
   * @param {string} text
   */
  setText(text) {
    if (this._text === text) {
      return;
    }
    this._textElement.textContent = text;
    this._textElement.classList.toggle('hidden', !text);
    this._text = text;
  }

  /**
   * @param {string} glyph
   */
  setGlyph(glyph) {
    if (this._glyph === glyph) {
      return;
    }
    this._glyphElement.setIconType(glyph);
    this._glyphElement.classList.toggle('hidden', !glyph);
    this.element.classList.toggle('toolbar-has-glyph', !!glyph);
    this._glyph = glyph;
  }

  /**
   * @param {string} iconURL
   */
  setBackgroundImage(iconURL) {
    this.element.style.backgroundImage = 'url(' + iconURL + ')';
  }

  setDarkText() {
    this.element.classList.add('dark-text');
  }

  /**
   * @param {number=} width
   */
  turnIntoSelect(width) {
    this.element.classList.add('toolbar-has-dropdown');
    const dropdownArrowIcon = UI.Icon.create('smallicon-triangle-down', 'toolbar-dropdown-arrow');
    this.element.appendChild(dropdownArrowIcon);
    if (width) {
      this.element.style.width = width + 'px';
    }
  }

  /**
   * @param {!Event} event
   */
  _clicked(event) {
    if (!this._enabled) {
      return;
    }
    this.dispatchEventToListeners(ToolbarButton.Events.Click, event);
    event.consume();
  }

  /**
   * @param {!Event} event
   */
  _keydown(event) {
    if (!this._enabled) {
      return;
    }
    this.dispatchEventToListeners(UI.ToolbarButton.Events.KeyDown, event);
    event.consume();
  }

  /**
   * @param {!Event} event
   */
  _mouseDown(event) {
    if (!this._enabled) {
      return;
    }
    this.dispatchEventToListeners(ToolbarButton.Events.MouseDown, event);
  }
}

ToolbarButton.Events = {
  Click: Symbol('Click'),
  KeyDown: Symbol('KeyDown'),
  MouseDown: Symbol('MouseDown')
};

class ToolbarInput extends ToolbarItem {
  /**
   * @param {string} placeholder
   * @param {string=} accessiblePlaceholder
   * @param {number=} growFactor
   * @param {number=} shrinkFactor
   * @param {string=} tooltip
   * @param {(function(string, string, boolean=):!Promise<!UI.SuggestBox.Suggestions>)=} completions
   */
  constructor(placeholder, accessiblePlaceholder, growFactor, shrinkFactor, tooltip, completions) {
    super(createElementWithClass('div', 'toolbar-input'));

    const internalPromptElement = this.element.createChild('div', 'toolbar-input-prompt');
    internalPromptElement.addEventListener('focus', () => this.element.classList.add('focused'));
    internalPromptElement.addEventListener('blur', () => this.element.classList.remove('focused'));

    this._prompt = new UI.TextPrompt();
    this._proxyElement = this._prompt.attach(internalPromptElement);
    this._proxyElement.classList.add('toolbar-prompt-proxy');
    this._proxyElement.addEventListener('keydown', event => this._onKeydownCallback(event));
    this._prompt.initialize(completions || (() => Promise.resolve([])), ' ');
    if (tooltip) {
      this._prompt.setTitle(tooltip);
    }
    this._prompt.setPlaceholder(placeholder, accessiblePlaceholder);
    this._prompt.addEventListener(UI.TextPrompt.Events.TextChanged, this._onChangeCallback.bind(this));

    if (growFactor) {
      this.element.style.flexGrow = growFactor;
    }
    if (shrinkFactor) {
      this.element.style.flexShrink = shrinkFactor;
    }

    const clearButton = this.element.createChild('div', 'toolbar-input-clear-button');
    clearButton.appendChild(UI.Icon.create('mediumicon-gray-cross-hover', 'search-cancel-button'));
    clearButton.addEventListener('click', () => {
      this.setValue('', true);
      this._prompt.focus();
    });

    this._updateEmptyStyles();
  }

  /**
   * @override
   * @param {boolean} enabled
   */
  _applyEnabledState(enabled) {
    this._prompt.setEnabled(enabled);
  }

  /**
   * @param {string} value
   * @param {boolean=} notify
   */
  setValue(value, notify) {
    this._prompt.setText(value);
    if (notify) {
      this._onChangeCallback();
    }
    this._updateEmptyStyles();
  }

  /**
   * @return {string}
   */
  value() {
    return this._prompt.textWithCurrentSuggestion();
  }

  /**
   * @param {!Event} event
   */
  _onKeydownCallback(event) {
    if (!isEscKey(event) || !this._prompt.text()) {
      return;
    }
    this.setValue('', true);
    event.consume(true);
  }

  _onChangeCallback() {
    this._updateEmptyStyles();
    this.dispatchEventToListeners(ToolbarInput.Event.TextChanged, this._prompt.text());
  }

  _updateEmptyStyles() {
    this.element.classList.toggle('toolbar-input-empty', !this._prompt.text());
  }
}

ToolbarInput.Event = {
  TextChanged: Symbol('TextChanged')
};

/**
 * @unrestricted
 */
class ToolbarToggle extends ToolbarButton {
  /**
   * @param {string} title
   * @param {string=} glyph
   * @param {string=} toggledGlyph
   */
  constructor(title, glyph, toggledGlyph) {
    super(title, glyph, '');
    this._toggled = false;
    this._untoggledGlyph = glyph;
    this._toggledGlyph = toggledGlyph;
    this.element.classList.add('toolbar-state-off');
    UI.ARIAUtils.setPressed(this.element, false);
  }

  /**
   * @return {boolean}
   */
  toggled() {
    return this._toggled;
  }

  /**
   * @param {boolean} toggled
   */
  setToggled(toggled) {
    if (this._toggled === toggled) {
      return;
    }
    this._toggled = toggled;
    this.element.classList.toggle('toolbar-state-on', toggled);
    this.element.classList.toggle('toolbar-state-off', !toggled);
    UI.ARIAUtils.setPressed(this.element, toggled);
    if (this._toggledGlyph && this._untoggledGlyph) {
      this.setGlyph(toggled ? this._toggledGlyph : this._untoggledGlyph);
    }
  }

  /**
   * @param {boolean} withRedColor
   */
  setDefaultWithRedColor(withRedColor) {
    this.element.classList.toggle('toolbar-default-with-red-color', withRedColor);
  }

  /**
   * @param {boolean} toggleWithRedColor
   */
  setToggleWithRedColor(toggleWithRedColor) {
    this.element.classList.toggle('toolbar-toggle-with-red-color', toggleWithRedColor);
  }
}


/**
 * @unrestricted
 */
class ToolbarMenuButton extends ToolbarButton {
  /**
   * @param {function(!UI.ContextMenu)} contextMenuHandler
   * @param {boolean=} useSoftMenu
   */
  constructor(contextMenuHandler, useSoftMenu) {
    super('', 'largeicon-menu');
    this._contextMenuHandler = contextMenuHandler;
    this._useSoftMenu = !!useSoftMenu;
    UI.ARIAUtils.markAsMenuButton(this.element);
  }

  /**
   * @override
   * @param {!Event} event
   */
  _mouseDown(event) {
    if (event.buttons !== 1) {
      super._mouseDown(event);
      return;
    }

    if (!this._triggerTimeout) {
      this._triggerTimeout = setTimeout(this._trigger.bind(this, event), 200);
    }
  }

  /**
   * @param {!Event} event
   */
  _trigger(event) {
    delete this._triggerTimeout;

    // Throttling avoids entering a bad state on Macs when rapidly triggering context menus just
    // after the window gains focus. See crbug.com/655556
    if (this._lastTriggerTime && Date.now() - this._lastTriggerTime < 300) {
      return;
    }
    const contextMenu = new UI.ContextMenu(
        event, this._useSoftMenu, this.element.totalOffsetLeft(),
        this.element.totalOffsetTop() + this.element.offsetHeight);
    this._contextMenuHandler(contextMenu);
    contextMenu.show();
    this._lastTriggerTime = Date.now();
  }

  /**
   * @override
   * @param {!Event} event
   */
  _clicked(event) {
    if (this._triggerTimeout) {
      clearTimeout(this._triggerTimeout);
    }
    this._trigger(event);
  }
}

/**
 * @unrestricted
 */
class ToolbarSettingToggle extends ToolbarToggle {
  /**
   * @param {!Common.Setting} setting
   * @param {string} glyph
   * @param {string} title
   */
  constructor(setting, glyph, title) {
    super(title, glyph);
    this._defaultTitle = title;
    this._setting = setting;
    this._settingChanged();
    this._setting.addChangeListener(this._settingChanged, this);
  }

  _settingChanged() {
    const toggled = this._setting.get();
    this.setToggled(toggled);
    this.setTitle(this._defaultTitle);
  }

  /**
   * @override
   * @param {!Event} event
   */
  _clicked(event) {
    this._setting.set(!this.toggled());
    super._clicked(event);
  }
}

/**
 * @unrestricted
 */
class ToolbarSeparator extends ToolbarItem {
  /**
   * @param {boolean=} spacer
   */
  constructor(spacer) {
    super(createElementWithClass('div', spacer ? 'toolbar-spacer' : 'toolbar-divider'));
  }
}

/**
 * @interface
 */
class Provider {
  /**
   * @return {?ToolbarItem}
   */
  item() {}
}

/**
 * @interface
 */
class ItemsProvider {
  /**
   * @return {!Array<!ToolbarItem>}
   */
  toolbarItems() {}
}

/**
 * @unrestricted
 */
class ToolbarComboBox extends ToolbarItem {
  /**
   * @param {?function(!Event)} changeHandler
   * @param {string} title
   * @param {string=} className
   */
  constructor(changeHandler, title, className) {
    super(createElementWithClass('span', 'toolbar-select-container'));

    this._selectElement = this.element.createChild('select', 'toolbar-item');
    const dropdownArrowIcon = UI.Icon.create('smallicon-triangle-down', 'toolbar-dropdown-arrow');
    this.element.appendChild(dropdownArrowIcon);
    if (changeHandler) {
      this._selectElement.addEventListener('change', changeHandler, false);
    }
    UI.ARIAUtils.setAccessibleName(this._selectElement, title);
    super.setTitle(title);
    if (className) {
      this._selectElement.classList.add(className);
    }
  }

  /**
   * @return {!HTMLSelectElement}
   */
  selectElement() {
    return /** @type {!HTMLSelectElement} */ (this._selectElement);
  }

  /**
   * @return {number}
   */
  size() {
    return this._selectElement.childElementCount;
  }

  /**
   * @return {!Array.<!Element>}
   */
  options() {
    return Array.prototype.slice.call(this._selectElement.children, 0);
  }

  /**
   * @param {!Element} option
   */
  addOption(option) {
    this._selectElement.appendChild(option);
  }

  /**
   * @param {string} label
   * @param {string=} value
   * @return {!Element}
   */
  createOption(label, value) {
    const option = this._selectElement.createChild('option');
    option.text = label;
    if (typeof value !== 'undefined') {
      option.value = value;
    }
    return option;
  }

  /**
   * @override
   * @param {boolean} enabled
   */
  _applyEnabledState(enabled) {
    super._applyEnabledState(enabled);
    this._selectElement.disabled = !enabled;
  }

  /**
   * @param {!Element} option
   */
  removeOption(option) {
    this._selectElement.removeChild(option);
  }

  removeOptions() {
    this._selectElement.removeChildren();
  }

  /**
   * @return {?Element}
   */
  selectedOption() {
    if (this._selectElement.selectedIndex >= 0) {
      return this._selectElement[this._selectElement.selectedIndex];
    }
    return null;
  }

  /**
   * @param {!Element} option
   */
  select(option) {
    this._selectElement.selectedIndex = Array.prototype.indexOf.call(/** @type {?} */ (this._selectElement), option);
  }

  /**
   * @param {number} index
   */
  setSelectedIndex(index) {
    this._selectElement.selectedIndex = index;
  }

  /**
   * @return {number}
   */
  selectedIndex() {
    return this._selectElement.selectedIndex;
  }

  /**
   * @param {number} width
   */
  setMaxWidth(width) {
    this._selectElement.style.maxWidth = width + 'px';
  }

  /**
   * @param {number} width
   */
  setMinWidth(width) {
    this._selectElement.style.minWidth = width + 'px';
  }
}

/**
 * @unrestricted
 */
class ToolbarSettingComboBox extends ToolbarComboBox {
  /**
   * @param {!Array<!{value: string, label: string}>} options
   * @param {!Common.Setting} setting
   * @param {string} accessibleName
   */
  constructor(options, setting, accessibleName) {
    super(null, accessibleName);
    this._options = options;
    this._setting = setting;
    this._selectElement.addEventListener('change', this._valueChanged.bind(this), false);
    this.setOptions(options);
    setting.addChangeListener(this._settingChanged, this);
  }

  /**
   * @param {!Array<!{value: string, label: string}>} options
   */
  setOptions(options) {
    this._options = options;
    this._selectElement.removeChildren();
    for (let i = 0; i < options.length; ++i) {
      const dataOption = options[i];
      const option = this.createOption(dataOption.label, dataOption.value);
      this._selectElement.appendChild(option);
      if (this._setting.get() === dataOption.value) {
        this.setSelectedIndex(i);
      }
    }
  }

  /**
   * @return {string}
   */
  value() {
    return this._options[this.selectedIndex()].value;
  }

  _settingChanged() {
    if (this._muteSettingListener) {
      return;
    }

    const value = this._setting.get();
    for (let i = 0; i < this._options.length; ++i) {
      if (value === this._options[i].value) {
        this.setSelectedIndex(i);
        break;
      }
    }
  }

  /**
   * @param {!Event} event
   */
  _valueChanged(event) {
    const option = this._options[this.selectedIndex()];
    this._muteSettingListener = true;
    this._setting.set(option.value);
    this._muteSettingListener = false;
  }
}

/**
 * @unrestricted
 */
class ToolbarCheckbox extends ToolbarItem {
  /**
   * @param {string} text
   * @param {string=} tooltip
   * @param {function()=} listener
   */
  constructor(text, tooltip, listener) {
    super(UI.CheckboxLabel.create(text));
    this.element.classList.add('checkbox');
    this.inputElement = this.element.checkboxElement;
    if (tooltip) {
      this.element.title = tooltip;
    }
    if (listener) {
      this.inputElement.addEventListener('click', listener, false);
    }
  }

  /**
   * @return {boolean}
   */
  checked() {
    return this.inputElement.checked;
  }

  /**
   * @param {boolean} value
   */
  setChecked(value) {
    this.inputElement.checked = value;
  }

  /**
   * @override
   * @param {boolean} enabled
   */
  _applyEnabledState(enabled) {
    super._applyEnabledState(enabled);
    this.inputElement.disabled = !enabled;
  }
}

class ToolbarSettingCheckbox extends ToolbarCheckbox {
  /**
   * @param {!Common.Setting} setting
   * @param {string=} tooltip
   * @param {string=} alternateTitle
   */
  constructor(setting, tooltip, alternateTitle) {
    super(alternateTitle || setting.title() || '', tooltip);
    UI.SettingsUI.bindCheckbox(this.inputElement, setting);
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Toolbar = Toolbar;

/** @constructor */
UI.ToolbarItem = ToolbarItem;

/** @constructor */
UI.ToolbarText = ToolbarText;

/** @constructor */
UI.ToolbarButton = ToolbarButton;

/** @constructor */
UI.ToolbarInput = ToolbarInput;

/** @constructor */
UI.ToolbarToggle = ToolbarToggle;

/** @constructor */
UI.ToolbarMenuButton = ToolbarMenuButton;

/** @constructor */
UI.ToolbarSettingToggle = ToolbarSettingToggle;

/** @constructor */
UI.ToolbarSeparator = ToolbarSeparator;

/** @interface */
UI.ToolbarItem.Provider = Provider;

/** @interface */
UI.ToolbarItem.ItemsProvider = ItemsProvider;

/** @constructor */
UI.ToolbarComboBox = ToolbarComboBox;

/** @constructor */
UI.ToolbarSettingComboBox = ToolbarSettingComboBox;

/** @constructor */
UI.ToolbarCheckbox = ToolbarCheckbox;

/** @constructor */
UI.ToolbarSettingCheckbox = ToolbarSettingCheckbox;

var Toolbar$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Toolbar,
  ToolbarItem: ToolbarItem,
  ToolbarText: ToolbarText,
  ToolbarButton: ToolbarButton,
  ToolbarInput: ToolbarInput,
  ToolbarToggle: ToolbarToggle,
  ToolbarMenuButton: ToolbarMenuButton,
  ToolbarSettingToggle: ToolbarSettingToggle,
  ToolbarSeparator: ToolbarSeparator,
  Provider: Provider,
  ItemsProvider: ItemsProvider,
  ToolbarComboBox: ToolbarComboBox,
  ToolbarSettingComboBox: ToolbarSettingComboBox,
  ToolbarCheckbox: ToolbarCheckbox,
  ToolbarSettingCheckbox: ToolbarSettingCheckbox
});

// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class Tooltip {
  /**
   * @param {!Document} doc
   */
  constructor(doc) {
    this.element = doc.body.createChild('div');
    this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, 'ui/tooltip.css');

    this._tooltipElement = this._shadowRoot.createChild('div', 'tooltip');
    doc.addEventListener('mousemove', this._mouseMove.bind(this), true);
    doc.addEventListener('mousedown', this._hide.bind(this, true), true);
    doc.addEventListener('mouseleave', this._hide.bind(this, false), true);
    doc.addEventListener('keydown', this._hide.bind(this, true), true);
    UI.zoomManager.addEventListener(UI.ZoomManager.Events.ZoomChanged, this._reset, this);
    doc.defaultView.addEventListener('resize', this._reset.bind(this), false);
  }

  /**
   * @param {!Document} doc
   */
  static installHandler(doc) {
    new Tooltip(doc);
  }

  /**
   * @param {!Element} element
   * @param {?Element|string} tooltipContent
   * @param {string=} actionId
   * @param {!Object=} options
   */
  static install(element, tooltipContent, actionId, options) {
    if (!tooltipContent) {
      delete element[_symbol$1];
      return;
    }
    element[_symbol$1] = {content: tooltipContent, actionId: actionId, options: options || {}};
  }

  /**
   * @param {!Element} element
   */
  static addNativeOverrideContainer(element) {
    _nativeOverrideContainer.push(element);
  }

  /**
   * @param {!Event} event
   */
  _mouseMove(event) {
    const mouseEvent = /** @type {!MouseEvent} */ (event);
    const path = mouseEvent.composedPath();
    if (!path || mouseEvent.buttons !== 0 || (mouseEvent.movementX === 0 && mouseEvent.movementY === 0)) {
      return;
    }

    if (this._anchorElement && path.indexOf(this._anchorElement) === -1) {
      this._hide(false);
    }

    for (const element of path) {
      if (element === this._anchorElement) {
        return;
      }
      // The offsetParent is null when the element or an ancestor has 'display: none'.
      if (!(element instanceof Element) || element.offsetParent === null) {
        continue;
      }
      if (element[_symbol$1]) {
        this._show(element, mouseEvent);
        return;
      }
    }
  }

  /**
   * @param {!Element} anchorElement
   * @param {!Event} event
   */
  _show(anchorElement, event) {
    const tooltip = anchorElement[_symbol$1];
    this._anchorElement = anchorElement;
    this._tooltipElement.removeChildren();

    // Check if native tooltips should be used.
    for (const element of _nativeOverrideContainer) {
      if (this._anchorElement.isSelfOrDescendant(element)) {
        Object.defineProperty(this._anchorElement, 'title', /** @type {!Object} */ (_nativeTitle));
        this._anchorElement.title = tooltip.content;
        return;
      }
    }

    if (typeof tooltip.content === 'string') {
      this._tooltipElement.setTextContentTruncatedIfNeeded(tooltip.content);
    } else {
      this._tooltipElement.appendChild(tooltip.content);
    }

    if (tooltip.actionId) {
      const shortcuts = UI.shortcutRegistry.shortcutDescriptorsForAction(tooltip.actionId);
      for (const shortcut of shortcuts) {
        const shortcutElement = this._tooltipElement.createChild('div', 'tooltip-shortcut');
        shortcutElement.textContent = shortcut.name;
      }
    }

    this._tooltipElement.classList.add('shown');
    // Reposition to ensure text doesn't overflow unnecessarily.
    this._tooltipElement.positionAt(0, 0);

    // Show tooltip instantly if a tooltip was shown recently.
    const now = Date.now();
    const instant = (this._tooltipLastClosed && now - this._tooltipLastClosed < Timing.InstantThreshold);
    this._tooltipElement.classList.toggle('instant', instant);
    this._tooltipLastOpened = instant ? now : now + Timing.OpeningDelay;

    // Get container element.
    const container = UI.GlassPane.container(/** @type {!Document} */ (anchorElement.ownerDocument));
    // Position tooltip based on the anchor element.
    const containerBox = container.boxInWindow(this.element.window());
    const anchorBox = this._anchorElement.boxInWindow(this.element.window());
    const anchorOffset = 2;
    const pageMargin = 2;
    const cursorOffset = 10;
    this._tooltipElement.classList.toggle('tooltip-breakword', !this._tooltipElement.textContent.match('\\s'));
    this._tooltipElement.style.maxWidth = (containerBox.width - pageMargin * 2) + 'px';
    this._tooltipElement.style.maxHeight = '';
    const tooltipWidth = this._tooltipElement.offsetWidth;
    const tooltipHeight = this._tooltipElement.offsetHeight;
    const anchorTooltipAtElement =
        this._anchorElement.nodeName === 'BUTTON' || this._anchorElement.nodeName === 'LABEL';
    let tooltipX = anchorTooltipAtElement ? anchorBox.x : event.x + cursorOffset;
    tooltipX = Number.constrain(
        tooltipX, containerBox.x + pageMargin, containerBox.x + containerBox.width - tooltipWidth - pageMargin);
    let tooltipY;
    if (!anchorTooltipAtElement) {
      tooltipY = event.y + cursorOffset + tooltipHeight < containerBox.y + containerBox.height ?
          event.y + cursorOffset :
          event.y - tooltipHeight - 1;
    } else {
      const onBottom =
          anchorBox.y + anchorOffset + anchorBox.height + tooltipHeight < containerBox.y + containerBox.height;
      tooltipY = onBottom ? anchorBox.y + anchorBox.height + anchorOffset : anchorBox.y - tooltipHeight - anchorOffset;
    }
    this._tooltipElement.positionAt(tooltipX, tooltipY);
  }

  /**
   * @param {boolean} removeInstant
   */
  _hide(removeInstant) {
    delete this._anchorElement;
    this._tooltipElement.classList.remove('shown');
    if (Date.now() > this._tooltipLastOpened) {
      this._tooltipLastClosed = Date.now();
    }
    if (removeInstant) {
      delete this._tooltipLastClosed;
    }
  }

  _reset() {
    this._hide(true);
    this._tooltipElement.positionAt(0, 0);
    this._tooltipElement.style.maxWidth = '0';
    this._tooltipElement.style.maxHeight = '0';
  }
}

const Timing = {
  // Max time between tooltips showing that no opening delay is required.
  'InstantThreshold': 300,
  // Wait time before opening a tooltip.
  'OpeningDelay': 600
};

const _symbol$1 = Symbol('Tooltip');

/** @type {!Array.<!Element>} */
const _nativeOverrideContainer = [];

const _nativeTitle = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'title');

Object.defineProperty(HTMLElement.prototype, 'title', {
  /**
   * @return {!Element|string}
   * @this {!Element}
   */
  get: function() {
    const tooltip = this[_symbol$1];
    return tooltip ? tooltip.content : '';
  },

  /**
   * @param {!Element|string} x
   * @this {!Element}
   */
  set: function(x) {
    Tooltip.install(this, x);
  }
});

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.Tooltip = Tooltip;

UI.Tooltip.Timing = Timing;
UI.Tooltip._symbol = _symbol$1;

/** @type {!Array.<!Element>} */
UI.Tooltip._nativeOverrideContainer = _nativeOverrideContainer;

UI.Tooltip._nativeTitle = _nativeTitle;

var Tooltip$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': Tooltip,
  Timing: Timing,
  _symbol: _symbol$1,
  _nativeOverrideContainer: _nativeOverrideContainer,
  _nativeTitle: _nativeTitle
});

/*
 * Copyright (C) 2007 Apple Inc.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * @unrestricted
 */
class TreeOutline extends Common.Object {
  constructor() {
    super();
    this._createRootElement();

    /** @type {?TreeElement} */
    this.selectedTreeElement = null;
    this.expandTreeElementsWhenArrowing = false;
    /** @type {?function(!TreeElement, !TreeElement):number} */
    this._comparator = null;

    this.contentElement = this._rootElement._childrenListNode;
    this.contentElement.addEventListener('keydown', this._treeKeyDown.bind(this), false);

    this._preventTabOrder = false;
    this._showSelectionOnKeyboardFocus = false;
    this._focusable = true;
    this.setFocusable(this._focusable);
    if (this._focusable) {
      this.contentElement.setAttribute('tabIndex', -1);
    }
    this.element = this.contentElement;
    UI.ARIAUtils.markAsTree(this.element);
  }

  /**
   * @param {boolean} show
   * @param {boolean=} preventTabOrder
   */
  setShowSelectionOnKeyboardFocus(show, preventTabOrder) {
    this.contentElement.classList.toggle('hide-selection-when-blurred', show);
    this._preventTabOrder = !!preventTabOrder;
    this._showSelectionOnKeyboardFocus = show;
  }

  _createRootElement() {
    this._rootElement = new TreeElement();
    this._rootElement.treeOutline = this;
    this._rootElement.root = true;
    this._rootElement.selectable = false;
    this._rootElement.expanded = true;
    this._rootElement._childrenListNode.classList.remove('children');
  }

  /**
   * @return {!TreeElement}
   */
  rootElement() {
    return this._rootElement;
  }

  /**
   * @return {?TreeElement}
   */
  firstChild() {
    return this._rootElement.firstChild();
  }

  /**
   * @return {?TreeElement}
   */
  _lastDescendent() {
    let last = this._rootElement.lastChild();
    while (last.expanded && last.childCount()) {
      last = last.lastChild();
    }
    return last;
  }

  /**
   * @param {!TreeElement} child
   */
  appendChild(child) {
    this._rootElement.appendChild(child);
  }

  /**
   * @param {!TreeElement} child
   * @param {number} index
   */
  insertChild(child, index) {
    this._rootElement.insertChild(child, index);
  }

  /**
   * @param {!TreeElement} child
   */
  removeChild(child) {
    this._rootElement.removeChild(child);
  }

  removeChildren() {
    this._rootElement.removeChildren();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @return {?TreeElement}
   */
  treeElementFromPoint(x, y) {
    const node = this.contentElement.ownerDocument.deepElementFromPoint(x, y);
    if (!node) {
      return null;
    }

    const listNode = node.enclosingNodeOrSelfWithNodeNameInArray(['ol', 'li']);
    if (listNode) {
      return listNode.parentTreeElement || listNode.treeElement;
    }
    return null;
  }

  /**
   * @param {?Event} event
   * @return {?TreeElement}
   */
  treeElementFromEvent(event) {
    return event ? this.treeElementFromPoint(event.pageX, event.pageY) : null;
  }

  /**
   * @param {?function(!TreeElement, !TreeElement):number} comparator
   */
  setComparator(comparator) {
    this._comparator = comparator;
  }

  /**
   * @param {boolean} focusable
   */
  setFocusable(focusable) {
    if (focusable) {
      this._focusable = true;
      this.contentElement.setAttribute('tabIndex', -1);
      if (this.selectedTreeElement) {
        this.selectedTreeElement._setFocusable(true);
      }
    } else {
      this._focusable = false;
      this.contentElement.removeAttribute('tabIndex');
      if (this.selectedTreeElement) {
        this.selectedTreeElement._setFocusable(false);
      }
    }
  }

  focus() {
    if (this.selectedTreeElement) {
      this.selectedTreeElement.listItemElement.focus();
    } else {
      this.contentElement.focus();
    }
  }

  useLightSelectionColor() {
    this._useLightSelectionColor = true;
  }

  /**
   * @param {!TreeElement} element
   */
  _bindTreeElement(element) {
    if (element.treeOutline) {
      console.error('Binding element for the second time: ' + new Error().stack);
    }
    element.treeOutline = this;
    element.onbind();
  }

  /**
   * @param {!TreeElement} element
   */
  _unbindTreeElement(element) {
    if (!element.treeOutline) {
      console.error('Unbinding element that was not bound: ' + new Error().stack);
    }

    element.deselect();
    element.onunbind();
    element.treeOutline = null;
  }

  /**
   * @return {boolean}
   */
  selectPrevious() {
    let nextSelectedElement = this.selectedTreeElement.traversePreviousTreeElement(true);
    while (nextSelectedElement && !nextSelectedElement.selectable) {
      nextSelectedElement = nextSelectedElement.traversePreviousTreeElement(!this.expandTreeElementsWhenArrowing);
    }
    if (!nextSelectedElement) {
      return false;
    }
    nextSelectedElement.select(false, true);
    return true;
  }

  /**
   * @return {boolean}
   */
  selectNext() {
    let nextSelectedElement = this.selectedTreeElement.traverseNextTreeElement(true);
    while (nextSelectedElement && !nextSelectedElement.selectable) {
      nextSelectedElement = nextSelectedElement.traverseNextTreeElement(!this.expandTreeElementsWhenArrowing);
    }
    if (!nextSelectedElement) {
      return false;
    }
    nextSelectedElement.select(false, true);
    return true;
  }

  forceSelect() {
    if (this.selectedTreeElement) {
      this.selectedTreeElement.deselect();
    }
    this._selectFirst();
  }

  /**
   * @return {boolean}
   */
  _selectFirst() {
    let first = this.firstChild();
    while (first && !first.selectable) {
      first = first.traverseNextTreeElement(true);
    }
    if (!first) {
      return false;
    }
    first.select(false, true);
    return true;
  }

  /**
   * @return {boolean}
   */
  _selectLast() {
    let last = this._lastDescendent();
    while (last && !last.selectable) {
      last = last.traversePreviousTreeElement(true);
    }
    if (!last) {
      return false;
    }
    last.select(false, true);
    return true;
  }

  /**
   * @param {!Event} event
   */
  _treeKeyDown(event) {
    if (!this.selectedTreeElement || event.shiftKey || event.metaKey || event.ctrlKey || UI.isEditing()) {
      return;
    }

    let handled = false;
    if (event.key === 'ArrowUp' && !event.altKey) {
      handled = this.selectPrevious();
    } else if (event.key === 'ArrowDown' && !event.altKey) {
      handled = this.selectNext();
    } else if (event.key === 'ArrowLeft') {
      handled = this.selectedTreeElement.collapseOrAscend(event.altKey);
    } else if (event.key === 'ArrowRight') {
      if (!this.selectedTreeElement.revealed()) {
        this.selectedTreeElement.reveal();
        handled = true;
      } else {
        handled = this.selectedTreeElement.descendOrExpand(event.altKey);
      }
    } else if (event.keyCode === 8 /* Backspace */ || event.keyCode === 46 /* Delete */) {
      handled = this.selectedTreeElement.ondelete();
    } else if (isEnterKey(event)) {
      handled = this.selectedTreeElement.onenter();
    } else if (event.keyCode === UI.KeyboardShortcut.Keys.Space.code) {
      handled = this.selectedTreeElement.onspace();
    } else if (event.key === 'Home') {
      handled = this._selectFirst();
    } else if (event.key === 'End') {
      handled = this._selectLast();
    }

    if (handled) {
      event.consume(true);
    }
  }

  /**
   * @param {!TreeElement} treeElement
   * @param {boolean} center
   */
  _deferredScrollIntoView(treeElement, center) {
    if (!this._treeElementToScrollIntoView) {
      this.element.window().requestAnimationFrame(deferredScrollIntoView.bind(this));
    }
    this._treeElementToScrollIntoView = treeElement;
    this._centerUponScrollIntoView = center;
    /**
     * @this {TreeOutline}
     */
    function deferredScrollIntoView() {
      this._treeElementToScrollIntoView.listItemElement.scrollIntoViewIfNeeded(this._centerUponScrollIntoView);
      delete this._treeElementToScrollIntoView;
      delete this._centerUponScrollIntoView;
    }
  }
}

/** @enum {symbol} */
const Events$1 = {
  ElementAttached: Symbol('ElementAttached'),
  ElementsDetached: Symbol('ElementsDetached'),
  ElementExpanded: Symbol('ElementExpanded'),
  ElementCollapsed: Symbol('ElementCollapsed'),
  ElementSelected: Symbol('ElementSelected')
};

/**
 * @unrestricted
 */
class TreeOutlineInShadow extends TreeOutline {
  constructor() {
    super();
    this.contentElement.classList.add('tree-outline');

    // Redefine element to the external one.
    this.element = createElement('div');
    this._shadowRoot = UI.createShadowRootWithCoreStyles(this.element, 'ui/treeoutline.css');
    this._disclosureElement = this._shadowRoot.createChild('div', 'tree-outline-disclosure');
    this._disclosureElement.appendChild(this.contentElement);
    this._renderSelection = true;
  }

  /**
   * @param {string} cssFile
   */
  registerRequiredCSS(cssFile) {
    UI.appendStyle(this._shadowRoot, cssFile);
  }

  hideOverflow() {
    this._disclosureElement.classList.add('tree-outline-disclosure-hide-overflow');
  }

  makeDense() {
    this.contentElement.classList.add('tree-outline-dense');
  }
}

/**
 * @unrestricted
 */
class TreeElement {
  /**
   * @param {(string|!Node)=} title
   * @param {boolean=} expandable
   */
  constructor(title, expandable) {
    /** @type {?TreeOutline} */
    this.treeOutline = null;
    this.parent = null;
    this.previousSibling = null;
    this.nextSibling = null;
    this._boundOnFocus = this._onFocus.bind(this);
    this._boundOnBlur = this._onBlur.bind(this);

    this._listItemNode = createElement('li');
    /** @protected */
    this.titleElement = this._listItemNode.createChild('span', 'tree-element-title');
    this._listItemNode.treeElement = this;
    if (title) {
      this.title = title;
    }
    this._listItemNode.addEventListener('mousedown', this._handleMouseDown.bind(this), false);
    this._listItemNode.addEventListener('click', this._treeElementToggled.bind(this), false);
    this._listItemNode.addEventListener('dblclick', this._handleDoubleClick.bind(this), false);
    UI.ARIAUtils.markAsTreeitem(this._listItemNode);

    this._childrenListNode = createElement('ol');
    this._childrenListNode.parentTreeElement = this;
    this._childrenListNode.classList.add('children');
    UI.ARIAUtils.markAsGroup(this._childrenListNode);

    this._hidden = false;
    this._selectable = true;
    this.expanded = false;
    this.selected = false;
    this.setExpandable(expandable || false);
    this._collapsible = true;
  }

  /**
   * @param {?TreeElement} ancestor
   * @return {boolean}
   */
  hasAncestor(ancestor) {
    if (!ancestor) {
      return false;
    }

    let currentNode = this.parent;
    while (currentNode) {
      if (ancestor === currentNode) {
        return true;
      }
      currentNode = currentNode.parent;
    }

    return false;
  }

  /**
   * @param {?TreeElement} ancestor
   * @return {boolean}
   */
  hasAncestorOrSelf(ancestor) {
    return this === ancestor || this.hasAncestor(ancestor);
  }

  /**
   * @return {!Array.<!TreeElement>}
   */
  children() {
    return this._children || [];
  }

  /**
   * @return {number}
   */
  childCount() {
    return this._children ? this._children.length : 0;
  }

  /**
   * @return {?TreeElement}
   */
  firstChild() {
    return this._children ? this._children[0] : null;
  }

  /**
   * @return {?TreeElement}
   */
  lastChild() {
    return this._children ? this._children[this._children.length - 1] : null;
  }

  /**
   * @param {number} index
   * @return {?TreeElement}
   */
  childAt(index) {
    return this._children ? this._children[index] : null;
  }

  /**
   * @param {!TreeElement} child
   * @return {number}
   */
  indexOfChild(child) {
    return this._children ? this._children.indexOf(child) : -1;
  }

  /**
   * @param {!TreeElement} child
   */
  appendChild(child) {
    if (!this._children) {
      this._children = [];
    }

    let insertionIndex;
    if (this.treeOutline && this.treeOutline._comparator) {
      insertionIndex = this._children.lowerBound(child, this.treeOutline._comparator);
    } else {
      insertionIndex = this._children.length;
    }
    this.insertChild(child, insertionIndex);
  }

  /**
   * @param {!TreeElement} child
   * @param {number} index
   */
  insertChild(child, index) {
    if (!this._children) {
      this._children = [];
    }

    if (!child) {
      throw 'child can\'t be undefined or null';
    }

    console.assert(
        !child.parent, 'Attempting to insert a child that is already in the tree, reparenting is not supported.');

    const previousChild = (index > 0 ? this._children[index - 1] : null);
    if (previousChild) {
      previousChild.nextSibling = child;
      child.previousSibling = previousChild;
    } else {
      child.previousSibling = null;
    }

    const nextChild = this._children[index];
    if (nextChild) {
      nextChild.previousSibling = child;
      child.nextSibling = nextChild;
    } else {
      child.nextSibling = null;
    }

    this._children.splice(index, 0, child);

    this.setExpandable(true);
    child.parent = this;

    if (this.treeOutline) {
      this.treeOutline._bindTreeElement(child);
    }
    for (let current = child.firstChild(); this.treeOutline && current;
         current = current.traverseNextTreeElement(false, child, true)) {
      this.treeOutline._bindTreeElement(current);
    }
    child.onattach();
    child._ensureSelection();
    if (this.treeOutline) {
      this.treeOutline.dispatchEventToListeners(Events$1.ElementAttached, child);
    }
    const nextSibling = child.nextSibling ? child.nextSibling._listItemNode : null;
    this._childrenListNode.insertBefore(child._listItemNode, nextSibling);
    this._childrenListNode.insertBefore(child._childrenListNode, nextSibling);
    if (child.selected) {
      child.select();
    }
    if (child.expanded) {
      child.expand();
    }
  }

  /**
   * @param {number} childIndex
   */
  removeChildAtIndex(childIndex) {
    if (childIndex < 0 || childIndex >= this._children.length) {
      throw 'childIndex out of range';
    }

    const child = this._children[childIndex];
    this._children.splice(childIndex, 1);

    const parent = child.parent;
    if (this.treeOutline && this.treeOutline.selectedTreeElement &&
        this.treeOutline.selectedTreeElement.hasAncestorOrSelf(child)) {
      if (child.nextSibling) {
        child.nextSibling.select(true);
      } else if (child.previousSibling) {
        child.previousSibling.select(true);
      } else if (parent) {
        parent.select(true);
      }
    }

    if (child.previousSibling) {
      child.previousSibling.nextSibling = child.nextSibling;
    }
    if (child.nextSibling) {
      child.nextSibling.previousSibling = child.previousSibling;
    }
    child.parent = null;

    if (this.treeOutline) {
      this.treeOutline._unbindTreeElement(child);
    }
    for (let current = child.firstChild(); this.treeOutline && current;
         current = current.traverseNextTreeElement(false, child, true)) {
      this.treeOutline._unbindTreeElement(current);
    }

    child._detach();
    if (this.treeOutline) {
      this.treeOutline.dispatchEventToListeners(Events$1.ElementsDetached);
    }
  }

  /**
   * @param {!TreeElement} child
   */
  removeChild(child) {
    if (!child) {
      throw 'child can\'t be undefined or null';
    }
    if (child.parent !== this) {
      return;
    }

    const childIndex = this._children.indexOf(child);
    if (childIndex === -1) {
      throw 'child not found in this node\'s children';
    }

    this.removeChildAtIndex(childIndex);
  }

  removeChildren() {
    if (!this.root && this.treeOutline && this.treeOutline.selectedTreeElement &&
        this.treeOutline.selectedTreeElement.hasAncestorOrSelf(this)) {
      this.select(true);
    }

    for (let i = 0; this._children && i < this._children.length; ++i) {
      const child = this._children[i];
      child.previousSibling = null;
      child.nextSibling = null;
      child.parent = null;

      if (this.treeOutline) {
        this.treeOutline._unbindTreeElement(child);
      }
      for (let current = child.firstChild(); this.treeOutline && current;
           current = current.traverseNextTreeElement(false, child, true)) {
        this.treeOutline._unbindTreeElement(current);
      }
      child._detach();
    }
    this._children = [];
    if (this.treeOutline) {
      this.treeOutline.dispatchEventToListeners(Events$1.ElementsDetached);
    }
  }

  get selectable() {
    if (this._hidden) {
      return false;
    }
    return this._selectable;
  }

  set selectable(x) {
    this._selectable = x;
  }

  get listItemElement() {
    return this._listItemNode;
  }

  get childrenListElement() {
    return this._childrenListNode;
  }

  /**
   * @return {string|!Node}
   */
  get title() {
    return this._title;
  }

  /**
   * @param {string|!Node} x
   */
  set title(x) {
    if (this._title === x) {
      return;
    }
    this._title = x;

    if (typeof x === 'string') {
      this.titleElement.textContent = x;
      this.tooltip = x;
    } else {
      this.titleElement = x;
      this.tooltip = '';
    }

    this._listItemNode.removeChildren();
    if (this._leadingIconsElement) {
      this._listItemNode.appendChild(this._leadingIconsElement);
    }
    this._listItemNode.appendChild(this.titleElement);
    if (this._trailingIconsElement) {
      this._listItemNode.appendChild(this._trailingIconsElement);
    }
    this._ensureSelection();
  }

  /**
   * @return {string}
   */
  titleAsText() {
    if (!this._title) {
      return '';
    }
    if (typeof this._title === 'string') {
      return this._title;
    }
    return this._title.textContent;
  }

  /**
   * @param {!UI.InplaceEditor.Config} editingConfig
   */
  startEditingTitle(editingConfig) {
    UI.InplaceEditor.startEditing(/** @type {!Element} */ (this.titleElement), editingConfig);
    this.treeOutline._shadowRoot.getSelection().selectAllChildren(this.titleElement);
  }

  /**
   * @param {!Array<!UI.Icon>} icons
   */
  setLeadingIcons(icons) {
    if (!this._leadingIconsElement && !icons.length) {
      return;
    }
    if (!this._leadingIconsElement) {
      this._leadingIconsElement = createElementWithClass('div', 'leading-icons');
      this._leadingIconsElement.classList.add('icons-container');
      this._listItemNode.insertBefore(this._leadingIconsElement, this.titleElement);
      this._ensureSelection();
    }
    this._leadingIconsElement.removeChildren();
    for (const icon of icons) {
      this._leadingIconsElement.appendChild(icon);
    }
  }

  /**
   * @param {!Array<!UI.Icon>} icons
   */
  setTrailingIcons(icons) {
    if (!this._trailingIconsElement && !icons.length) {
      return;
    }
    if (!this._trailingIconsElement) {
      this._trailingIconsElement = createElementWithClass('div', 'trailing-icons');
      this._trailingIconsElement.classList.add('icons-container');
      this._listItemNode.appendChild(this._trailingIconsElement);
      this._ensureSelection();
    }
    this._trailingIconsElement.removeChildren();
    for (const icon of icons) {
      this._trailingIconsElement.appendChild(icon);
    }
  }


  /**
   * @return {string}
   */
  get tooltip() {
    return this._tooltip || '';
  }

  /**
   * @param {string} x
   */
  set tooltip(x) {
    if (this._tooltip === x) {
      return;
    }
    this._tooltip = x;
    this._listItemNode.title = x;
  }

  /**
   * @return {boolean}
   */
  isExpandable() {
    return this._expandable;
  }

  /**
   * @param {boolean} expandable
   */
  setExpandable(expandable) {
    if (this._expandable === expandable) {
      return;
    }

    this._expandable = expandable;

    this._listItemNode.classList.toggle('parent', expandable);
    if (!expandable) {
      this.collapse();
      UI.ARIAUtils.unsetExpandable(this._listItemNode);
    } else {
      UI.ARIAUtils.setExpanded(this._listItemNode, false);
    }
  }

  /**
   * @param {boolean} collapsible
   */
  setCollapsible(collapsible) {
    if (this._collapsible === collapsible) {
      return;
    }

    this._collapsible = collapsible;

    this._listItemNode.classList.toggle('always-parent', !collapsible);
    if (!collapsible) {
      this.expand();
    }
  }

  get hidden() {
    return this._hidden;
  }

  set hidden(x) {
    if (this._hidden === x) {
      return;
    }

    this._hidden = x;

    this._listItemNode.classList.toggle('hidden', x);
    this._childrenListNode.classList.toggle('hidden', x);
  }

  invalidateChildren() {
    if (this._children) {
      this.removeChildren();
      this._children = null;
    }
  }


  _ensureSelection() {
    if (!this.treeOutline || !this.treeOutline._renderSelection) {
      return;
    }
    if (!this._selectionElement) {
      this._selectionElement = createElementWithClass('div', 'selection fill');
    }
    this._listItemNode.insertBefore(this._selectionElement, this.listItemElement.firstChild);
  }

  /**
   * @param {!Event} event
   */
  _treeElementToggled(event) {
    const element = event.currentTarget;
    if (element.treeElement !== this || element.hasSelection()) {
      return;
    }

    console.assert(!!this.treeOutline);
    const showSelectionOnKeyboardFocus = this.treeOutline ? this.treeOutline._showSelectionOnKeyboardFocus : false;
    const toggleOnClick = this.toggleOnClick && (showSelectionOnKeyboardFocus || !this.selectable);
    const isInTriangle = this.isEventWithinDisclosureTriangle(event);
    if (!toggleOnClick && !isInTriangle) {
      return;
    }

    if (this.expanded) {
      if (event.altKey) {
        this.collapseRecursively();
      } else {
        this.collapse();
      }
    } else {
      if (event.altKey) {
        this.expandRecursively();
      } else {
        this.expand();
      }
    }
    event.consume();
  }

  /**
   * @param {!Event} event
   */
  _handleMouseDown(event) {
    const element = event.currentTarget;
    if (!element) {
      return;
    }
    if (!this.selectable) {
      return;
    }
    if (element.treeElement !== this) {
      return;
    }

    if (this.isEventWithinDisclosureTriangle(event)) {
      return;
    }

    this.selectOnMouseDown(event);
  }

  /**
   * @param {!Event} event
   */
  _handleDoubleClick(event) {
    const element = event.currentTarget;
    if (!element || element.treeElement !== this) {
      return;
    }

    const handled = this.ondblclick(event);
    if (handled) {
      return;
    }
    if (this._expandable && !this.expanded) {
      this.expand();
    }
  }

  _detach() {
    this._listItemNode.remove();
    this._childrenListNode.remove();
  }

  collapse() {
    if (!this.expanded || !this._collapsible) {
      return;
    }
    this._listItemNode.classList.remove('expanded');
    this._childrenListNode.classList.remove('expanded');
    UI.ARIAUtils.setExpanded(this._listItemNode, false);
    this.expanded = false;
    this.oncollapse();
    if (this.treeOutline) {
      this.treeOutline.dispatchEventToListeners(Events$1.ElementCollapsed, this);
    }
  }

  collapseRecursively() {
    let item = this;
    while (item) {
      if (item.expanded) {
        item.collapse();
      }
      item = item.traverseNextTreeElement(false, this, true);
    }
  }

  collapseChildren() {
    if (!this._children) {
      return;
    }
    for (const child of this._children) {
      child.collapseRecursively();
    }
  }

  expand() {
    if (!this._expandable || (this.expanded && this._children)) {
      return;
    }

    // Set this before onpopulate. Since onpopulate can add elements, this makes
    // sure the expanded flag is true before calling those functions. This prevents the possibility
    // of an infinite loop if onpopulate were to call expand.

    this.expanded = true;

    this._populateIfNeeded();
    this._listItemNode.classList.add('expanded');
    this._childrenListNode.classList.add('expanded');
    UI.ARIAUtils.setExpanded(this._listItemNode, true);

    if (this.treeOutline) {
      this.onexpand();
      this.treeOutline.dispatchEventToListeners(Events$1.ElementExpanded, this);
    }
  }

  /**
   * @param {number=} maxDepth
   * @returns {!Promise}
   */
  async expandRecursively(maxDepth) {
    let item = this;
    const info = {};
    let depth = 0;

    // The Inspector uses TreeOutlines to represents object properties, so recursive expansion
    // in some case can be infinite, since JavaScript objects can hold circular references.
    // So default to a recursion cap of 3 levels, since that gives fairly good results.
    if (isNaN(maxDepth)) {
      maxDepth = 3;
    }

    while (item) {
      await item._populateIfNeeded();

      if (depth < maxDepth) {
        item.expand();
      }

      item = item.traverseNextTreeElement(false, this, (depth >= maxDepth), info);
      depth += info.depthChange;
    }
  }

  /**
   * @param {boolean} altKey
   * @return {boolean}
   */
  collapseOrAscend(altKey) {
    if (this.expanded && this._collapsible) {
      if (altKey) {
        this.collapseRecursively();
      } else {
        this.collapse();
      }
      return true;
    }

    if (!this.parent || this.parent.root) {
      return false;
    }

    if (!this.parent.selectable) {
      this.parent.collapse();
      return true;
    }

    let nextSelectedElement = this.parent;
    while (nextSelectedElement && !nextSelectedElement.selectable) {
      nextSelectedElement = nextSelectedElement.parent;
    }

    if (!nextSelectedElement) {
      return false;
    }
    nextSelectedElement.select(false, true);
    return true;
  }

  /**
   * @param {boolean} altKey
   * @return {boolean}
   */
  descendOrExpand(altKey) {
    if (!this._expandable) {
      return false;
    }

    if (!this.expanded) {
      if (altKey) {
        this.expandRecursively();
      } else {
        this.expand();
      }
      return true;
    }

    let nextSelectedElement = this.firstChild();
    while (nextSelectedElement && !nextSelectedElement.selectable) {
      nextSelectedElement = nextSelectedElement.nextSibling;
    }

    if (!nextSelectedElement) {
      return false;
    }
    nextSelectedElement.select(false, true);
    return true;
  }

  /**
   * @param {boolean=} center
   */
  reveal(center) {
    let currentAncestor = this.parent;
    while (currentAncestor && !currentAncestor.root) {
      if (!currentAncestor.expanded) {
        currentAncestor.expand();
      }
      currentAncestor = currentAncestor.parent;
    }

    this.treeOutline._deferredScrollIntoView(this, !!center);
  }

  /**
   * @return {boolean}
   */
  revealed() {
    let currentAncestor = this.parent;
    while (currentAncestor && !currentAncestor.root) {
      if (!currentAncestor.expanded) {
        return false;
      }
      currentAncestor = currentAncestor.parent;
    }

    return true;
  }

  selectOnMouseDown(event) {
    if (this.select(false, true)) {
      event.consume(true);
    }

    if (this._listItemNode.draggable && this._selectionElement) {
      const marginLeft =
          this.treeOutline.element.getBoundingClientRect().left - this._listItemNode.getBoundingClientRect().left;
      // By default the left margin extends far off screen. This is not a problem except when dragging an element.
      // Setting the margin once here should be fine, because we believe the left margin should never change.
      this._selectionElement.style.setProperty('margin-left', marginLeft + 'px');
    }
  }

  /**
   * @param {boolean=} omitFocus
   * @param {boolean=} selectedByUser
   * @return {boolean}
   */
  select(omitFocus, selectedByUser) {
    if (!this.treeOutline || !this.selectable || this.selected) {
      if (!omitFocus) {
        this.listItemElement.focus();
      }
      return false;
    }
    // Wait to deselect this element so that focus only changes once
    const lastSelected = this.treeOutline.selectedTreeElement;
    this.treeOutline.selectedTreeElement = null;

    if (this.treeOutline._rootElement === this) {
      if (lastSelected) {
        lastSelected.deselect();
      }
      if (!omitFocus) {
        this.listItemElement.focus();
      }
      return false;
    }

    this.selected = true;

    this.treeOutline.selectedTreeElement = this;
    if (this.treeOutline._focusable) {
      this._setFocusable(true);
    }
    if (!omitFocus || this.treeOutline.contentElement.hasFocus()) {
      this.listItemElement.focus();
    }

    this._listItemNode.classList.add('selected');
    this.treeOutline.dispatchEventToListeners(Events$1.ElementSelected, this);
    if (lastSelected) {
      lastSelected.deselect();
    }
    return this.onselect(selectedByUser);
  }

  /**
   * @param {boolean} focusable
   */
  _setFocusable(focusable) {
    if (focusable) {
      this._listItemNode.setAttribute('tabIndex', this.treeOutline && this.treeOutline._preventTabOrder ? -1 : 0);
      this._listItemNode.addEventListener('focus', this._boundOnFocus, false);
      this._listItemNode.addEventListener('blur', this._boundOnBlur, false);
    } else {
      this._listItemNode.removeAttribute('tabIndex');
      this._listItemNode.removeEventListener('focus', this._boundOnFocus, false);
      this._listItemNode.removeEventListener('blur', this._boundOnBlur, false);
    }
  }

  _onFocus() {
    if (this.treeOutline._useLightSelectionColor) {
      return;
    }
    if (!this.treeOutline.contentElement.classList.contains('hide-selection-when-blurred')) {
      this._listItemNode.classList.add('force-white-icons');
    }
  }

  _onBlur() {
    if (this.treeOutline._useLightSelectionColor) {
      return;
    }
    if (!this.treeOutline.contentElement.classList.contains('hide-selection-when-blurred')) {
      this._listItemNode.classList.remove('force-white-icons');
    }
  }

  /**
   * @param {boolean=} omitFocus
   */
  revealAndSelect(omitFocus) {
    this.reveal(true);
    this.select(omitFocus);
  }

  deselect() {
    const hadFocus = this._listItemNode.hasFocus();
    this.selected = false;
    this._listItemNode.classList.remove('selected');
    this._setFocusable(false);

    if (this.treeOutline && this.treeOutline.selectedTreeElement === this) {
      this.treeOutline.selectedTreeElement = null;
      if (hadFocus) {
        this.treeOutline.focus();
      }
    }
  }

  /**
   * @returns {!Promise}
   */
  async _populateIfNeeded() {
    if (this.treeOutline && this._expandable && !this._children) {
      this._children = [];
      await this.onpopulate();
    }
  }

  /**
   * @return {!Promise}
   */
  async onpopulate() {
    // Overridden by subclasses.
  }

  /**
   * @return {boolean}
   */
  onenter() {
    return false;
  }

  /**
   * @return {boolean}
   */
  ondelete() {
    return false;
  }

  /**
   * @return {boolean}
   */
  onspace() {
    return false;
  }

  onbind() {
  }

  onunbind() {
  }

  onattach() {
  }

  onexpand() {
  }

  oncollapse() {
  }

  /**
   * @param {!Event} e
   * @return {boolean}
   */
  ondblclick(e) {
    return false;
  }

  /**
   * @param {boolean=} selectedByUser
   * @return {boolean}
   */
  onselect(selectedByUser) {
    return false;
  }

  /**
   * @param {boolean} skipUnrevealed
   * @param {?TreeElement=} stayWithin
   * @param {boolean=} dontPopulate
   * @param {!Object=} info
   * @return {?TreeElement}
   */
  traverseNextTreeElement(skipUnrevealed, stayWithin, dontPopulate, info) {
    if (!dontPopulate) {
      this._populateIfNeeded();
    }

    if (info) {
      info.depthChange = 0;
    }

    let element = skipUnrevealed ? (this.revealed() ? this.firstChild() : null) : this.firstChild();
    if (element && (!skipUnrevealed || (skipUnrevealed && this.expanded))) {
      if (info) {
        info.depthChange = 1;
      }
      return element;
    }

    if (this === stayWithin) {
      return null;
    }

    element = skipUnrevealed ? (this.revealed() ? this.nextSibling : null) : this.nextSibling;
    if (element) {
      return element;
    }

    element = this;
    while (element && !element.root &&
           !(skipUnrevealed ? (element.revealed() ? element.nextSibling : null) : element.nextSibling) &&
           element.parent !== stayWithin) {
      if (info) {
        info.depthChange -= 1;
      }
      element = element.parent;
    }

    if (!element || element.root) {
      return null;
    }

    return (skipUnrevealed ? (element.revealed() ? element.nextSibling : null) : element.nextSibling);
  }

  /**
   * @param {boolean} skipUnrevealed
   * @param {boolean=} dontPopulate
   * @return {?TreeElement}
   */
  traversePreviousTreeElement(skipUnrevealed, dontPopulate) {
    let element = skipUnrevealed ? (this.revealed() ? this.previousSibling : null) : this.previousSibling;
    if (!dontPopulate && element) {
      element._populateIfNeeded();
    }

    while (element &&
           (skipUnrevealed ? (element.revealed() && element.expanded ? element.lastChild() : null) :
                             element.lastChild())) {
      if (!dontPopulate) {
        element._populateIfNeeded();
      }
      element =
          (skipUnrevealed ? (element.revealed() && element.expanded ? element.lastChild() : null) :
                            element.lastChild());
    }

    if (element) {
      return element;
    }

    if (!this.parent || this.parent.root) {
      return null;
    }

    return this.parent;
  }

  /**
   * @return {boolean}
   */
  isEventWithinDisclosureTriangle(event) {
    // FIXME: We should not use getComputedStyle(). For that we need to get rid of using ::before for disclosure triangle. (http://webk.it/74446)
    const paddingLeftValue = window.getComputedStyle(this._listItemNode).paddingLeft;
    console.assert(paddingLeftValue.endsWith('px'));
    const computedLeftPadding = parseFloat(paddingLeftValue);
    const left = this._listItemNode.totalOffsetLeft() + computedLeftPadding;
    return event.pageX >= left && event.pageX <= left + TreeElement._ArrowToggleWidth && this._expandable;
  }
}

/** @const */
TreeElement._ArrowToggleWidth = 10;

(function() {
const img = new Image();
img.src = 'Images/treeoutlineTriangles.svg';
TreeElement._imagePreload = img;
})();

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.TreeOutline = TreeOutline;

UI.TreeOutline.Events = Events$1;

/** @constructor */
UI.TreeElement = TreeElement;

/** @constructor */
UI.TreeOutlineInShadow = TreeOutlineInShadow;

var Treeoutline = /*#__PURE__*/Object.freeze({
  __proto__: null,
  TreeOutline: TreeOutline,
  TreeOutlineInShadow: TreeOutlineInShadow,
  TreeElement: TreeElement
});

/*
 * Copyright (C) 2011 Google Inc.  All rights reserved.
 * Copyright (C) 2006, 2007, 2008 Apple Inc.  All rights reserved.
 * Copyright (C) 2007 Matt Lilek (pewtermoose@gmail.com).
 * Copyright (C) 2009 Joseph Pecoraro
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Computer, Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
const highlightedSearchResultClassName = 'highlighted-search-result';
const highlightedCurrentSearchResultClassName = 'current-search-result';

/**
 * @param {!Element} element
 * @param {?function(!MouseEvent): boolean} elementDragStart
 * @param {function(!MouseEvent)} elementDrag
 * @param {?function(!MouseEvent)} elementDragEnd
 * @param {?string} cursor
 * @param {?string=} hoverCursor
 * @param {number=} startDelay
 */
function installDragHandle(
    element, elementDragStart, elementDrag, elementDragEnd, cursor, hoverCursor, startDelay) {
  /**
   * @param {!Event} event
   */
  function onMouseDown(event) {
    const dragHandler = new DragHandler();
    const dragStart = dragHandler.elementDragStart.bind(
        dragHandler, element, elementDragStart, elementDrag, elementDragEnd, cursor, event);
    if (startDelay) {
      startTimer = setTimeout(dragStart, startDelay);
    } else {
      dragStart();
    }
  }

  function onMouseUp() {
    if (startTimer) {
      clearTimeout(startTimer);
    }
    startTimer = null;
  }

  let startTimer;
  element.addEventListener('mousedown', onMouseDown, false);
  if (startDelay) {
    element.addEventListener('mouseup', onMouseUp, false);
  }
  if (hoverCursor !== null) {
    element.style.cursor = hoverCursor || cursor || '';
  }
}

/**
 * @param {!Element} targetElement
 * @param {?function(!MouseEvent):boolean} elementDragStart
 * @param {function(!MouseEvent)} elementDrag
 * @param {?function(!MouseEvent)} elementDragEnd
 * @param {?string} cursor
 * @param {!Event} event
 */
function elementDragStart(targetElement, elementDragStart, elementDrag, elementDragEnd, cursor, event) {
  const dragHandler = new DragHandler();
  dragHandler.elementDragStart(targetElement, elementDragStart, elementDrag, elementDragEnd, cursor, event);
}

/**
 * @unrestricted
 */
class DragHandler {
  constructor() {
    this._elementDragMove = this._elementDragMove.bind(this);
    this._elementDragEnd = this._elementDragEnd.bind(this);
    this._mouseOutWhileDragging = this._mouseOutWhileDragging.bind(this);
  }

  _createGlassPane() {
    this._glassPaneInUse = true;
    if (!DragHandler._glassPaneUsageCount++) {
      DragHandler._glassPane = new UI.GlassPane();
      DragHandler._glassPane.setPointerEventsBehavior(UI.GlassPane.PointerEventsBehavior.BlockedByGlassPane);
      DragHandler._glassPane.show(DragHandler._documentForMouseOut);
    }
  }

  _disposeGlassPane() {
    if (!this._glassPaneInUse) {
      return;
    }
    this._glassPaneInUse = false;
    if (--DragHandler._glassPaneUsageCount) {
      return;
    }
    DragHandler._glassPane.hide();
    delete DragHandler._glassPane;
    delete DragHandler._documentForMouseOut;
  }

  /**
   * @param {!Element} targetElement
   * @param {?function(!MouseEvent):boolean} elementDragStart
   * @param {function(!MouseEvent)} elementDrag
   * @param {?function(!MouseEvent)} elementDragEnd
   * @param {?string} cursor
   * @param {!Event} event
   */
  elementDragStart(targetElement, elementDragStart, elementDrag, elementDragEnd, cursor, event) {
    // Only drag upon left button. Right will likely cause a context menu. So will ctrl-click on mac.
    if (event.button || (Host.isMac() && event.ctrlKey)) {
      return;
    }

    if (this._elementDraggingEventListener) {
      return;
    }

    if (elementDragStart && !elementDragStart(/** @type {!MouseEvent} */ (event))) {
      return;
    }

    const targetDocument = event.target.ownerDocument;
    this._elementDraggingEventListener = elementDrag;
    this._elementEndDraggingEventListener = elementDragEnd;
    console.assert(
        (DragHandler._documentForMouseOut || targetDocument) === targetDocument, 'Dragging on multiple documents.');
    DragHandler._documentForMouseOut = targetDocument;
    this._dragEventsTargetDocument = targetDocument;
    try {
      this._dragEventsTargetDocumentTop = targetDocument.defaultView.top.document;
    } catch (e) {
      this._dragEventsTargetDocumentTop = this._dragEventsTargetDocument;
    }

    targetDocument.addEventListener('mousemove', this._elementDragMove, true);
    targetDocument.addEventListener('mouseup', this._elementDragEnd, true);
    targetDocument.addEventListener('mouseout', this._mouseOutWhileDragging, true);
    if (targetDocument !== this._dragEventsTargetDocumentTop) {
      this._dragEventsTargetDocumentTop.addEventListener('mouseup', this._elementDragEnd, true);
    }

    if (typeof cursor === 'string') {
      this._restoreCursorAfterDrag = restoreCursor.bind(this, targetElement.style.cursor);
      targetElement.style.cursor = cursor;
      targetDocument.body.style.cursor = cursor;
    }
    /**
     * @param {string} oldCursor
     * @this {DragHandler}
     */
    function restoreCursor(oldCursor) {
      targetDocument.body.style.removeProperty('cursor');
      targetElement.style.cursor = oldCursor;
      this._restoreCursorAfterDrag = null;
    }
    event.preventDefault();
  }

  _mouseOutWhileDragging() {
    this._unregisterMouseOutWhileDragging();
    this._createGlassPane();
  }

  _unregisterMouseOutWhileDragging() {
    if (!DragHandler._documentForMouseOut) {
      return;
    }
    DragHandler._documentForMouseOut.removeEventListener('mouseout', this._mouseOutWhileDragging, true);
  }

  _unregisterDragEvents() {
    if (!this._dragEventsTargetDocument) {
      return;
    }
    this._dragEventsTargetDocument.removeEventListener('mousemove', this._elementDragMove, true);
    this._dragEventsTargetDocument.removeEventListener('mouseup', this._elementDragEnd, true);
    if (this._dragEventsTargetDocument !== this._dragEventsTargetDocumentTop) {
      this._dragEventsTargetDocumentTop.removeEventListener('mouseup', this._elementDragEnd, true);
    }
    delete this._dragEventsTargetDocument;
    delete this._dragEventsTargetDocumentTop;
  }

  /**
   * @param {!Event} event
   */
  _elementDragMove(event) {
    if (event.buttons !== 1) {
      this._elementDragEnd(event);
      return;
    }
    if (this._elementDraggingEventListener(/** @type {!MouseEvent} */ (event))) {
      this._cancelDragEvents(event);
    }
  }

  /**
   * @param {!Event} event
   */
  _cancelDragEvents(event) {
    this._unregisterDragEvents();
    this._unregisterMouseOutWhileDragging();

    if (this._restoreCursorAfterDrag) {
      this._restoreCursorAfterDrag();
    }

    this._disposeGlassPane();

    delete this._elementDraggingEventListener;
    delete this._elementEndDraggingEventListener;
  }

  /**
   * @param {!Event} event
   */
  _elementDragEnd(event) {
    const elementDragEnd = this._elementEndDraggingEventListener;
    this._cancelDragEvents(/** @type {!MouseEvent} */ (event));
    event.preventDefault();
    if (elementDragEnd) {
      elementDragEnd(/** @type {!MouseEvent} */ (event));
    }
  }
}

DragHandler._glassPaneUsageCount = 0;

/**
 * @param {?Node=} node
 * @return {boolean}
 */
function isBeingEdited(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  let element = /** {!Element} */ (node);
  if (element.classList.contains('text-prompt') || element.nodeName === 'INPUT' || element.nodeName === 'TEXTAREA') {
    return true;
  }

  if (!UI.__editingCount) {
    return false;
  }

  while (element) {
    if (element.__editing) {
      return true;
    }
    element = element.parentElementOrShadowHost();
  }
  return false;
}

/**
 * @return {boolean}
 * @suppressGlobalPropertiesCheck
 */
function isEditing() {
  if (UI.__editingCount) {
    return true;
  }

  const focused = document.deepActiveElement();
  if (!focused) {
    return false;
  }
  return focused.classList.contains('text-prompt') || focused.nodeName === 'INPUT' || focused.nodeName === 'TEXTAREA';
}

/**
 * @param {!Element} element
 * @param {boolean} value
 * @return {boolean}
 */
function markBeingEdited(element, value) {
  if (value) {
    if (element.__editing) {
      return false;
    }
    element.classList.add('being-edited');
    element.__editing = true;
    UI.__editingCount = (UI.__editingCount || 0) + 1;
  } else {
    if (!element.__editing) {
      return false;
    }
    element.classList.remove('being-edited');
    delete element.__editing;
    --UI.__editingCount;
  }
  return true;
}

// Avoids Infinity, NaN, and scientific notation (e.g. 1e20), see crbug.com/81165.
const _numberRegex = /^(-?(?:\d+(?:\.\d+)?|\.\d+))$/;

const StyleValueDelimiters = ' \xA0\t\n"\':;,/()';

/**
 * @param {!Event} event
 * @return {?string}
 */
function _valueModificationDirection(event) {
  let direction = null;
  if (event.type === 'mousewheel') {
    // When shift is pressed while spinning mousewheel, delta comes as wheelDeltaX.
    if (event.wheelDeltaY > 0 || event.wheelDeltaX > 0) {
      direction = 'Up';
    } else if (event.wheelDeltaY < 0 || event.wheelDeltaX < 0) {
      direction = 'Down';
    }
  } else {
    if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      direction = 'Up';
    } else if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      direction = 'Down';
    }
  }
  return direction;
}

/**
 * @param {string} hexString
 * @param {!Event} event
 * @return {?string}
 */
function _modifiedHexValue(hexString, event) {
  const direction = _valueModificationDirection(event);
  if (!direction) {
    return null;
  }

  const mouseEvent = /** @type {!MouseEvent} */ (event);
  const number = parseInt(hexString, 16);
  if (isNaN(number) || !isFinite(number)) {
    return null;
  }

  const hexStrLen = hexString.length;
  const channelLen = hexStrLen / 3;

  // Colors are either rgb or rrggbb.
  if (channelLen !== 1 && channelLen !== 2) {
    return null;
  }

  // Precision modifier keys work with both mousewheel and up/down keys.
  // When ctrl is pressed, increase R by 1.
  // When shift is pressed, increase G by 1.
  // When alt is pressed, increase B by 1.
  // If no shortcut keys are pressed then increase hex value by 1.
  // Keys can be pressed together to increase RGB channels. e.g trying different shades.
  let delta = 0;
  if (UI.KeyboardShortcut.eventHasCtrlOrMeta(mouseEvent)) {
    delta += Math.pow(16, channelLen * 2);
  }
  if (mouseEvent.shiftKey) {
    delta += Math.pow(16, channelLen);
  }
  if (mouseEvent.altKey) {
    delta += 1;
  }
  if (delta === 0) {
    delta = 1;
  }
  if (direction === 'Down') {
    delta *= -1;
  }

  // Increase hex value by 1 and clamp from 0 ... maxValue.
  const maxValue = Math.pow(16, hexStrLen) - 1;
  const result = Number.constrain(number + delta, 0, maxValue);

  // Ensure the result length is the same as the original hex value.
  let resultString = result.toString(16).toUpperCase();
  for (let i = 0, lengthDelta = hexStrLen - resultString.length; i < lengthDelta; ++i) {
    resultString = '0' + resultString;
  }
  return resultString;
}

/**
 * @param {number} number
 * @param {!Event} event
 * @param {number=} modifierMultiplier
 * @return {?number}
 */
function _modifiedFloatNumber(number, event, modifierMultiplier) {
  const direction = _valueModificationDirection(event);
  if (!direction) {
    return null;
  }

  const mouseEvent = /** @type {!MouseEvent} */ (event);

  // Precision modifier keys work with both mousewheel and up/down keys.
  // When ctrl is pressed, increase by 100.
  // When shift is pressed, increase by 10.
  // When alt is pressed, increase by 0.1.
  // Otherwise increase by 1.
  let delta = 1;
  if (UI.KeyboardShortcut.eventHasCtrlOrMeta(mouseEvent)) {
    delta = 100;
  } else if (mouseEvent.shiftKey) {
    delta = 10;
  } else if (mouseEvent.altKey) {
    delta = 0.1;
  }

  if (direction === 'Down') {
    delta *= -1;
  }
  if (modifierMultiplier) {
    delta *= modifierMultiplier;
  }

  // Make the new number and constrain it to a precision of 6, this matches numbers the engine returns.
  // Use the Number constructor to forget the fixed precision, so 1.100000 will print as 1.1.
  const result = Number((number + delta).toFixed(6));
  if (!String(result).match(_numberRegex)) {
    return null;
  }
  return result;
}

/**
 * @param {string} wordString
 * @param {!Event} event
 * @param {function(string, number, string):string=} customNumberHandler
 * @return {?string}
 */
function createReplacementString(wordString, event, customNumberHandler) {
  let prefix;
  let suffix;
  let number;
  let replacementString = null;
  let matches = /(.*#)([\da-fA-F]+)(.*)/.exec(wordString);
  if (matches && matches.length) {
    prefix = matches[1];
    suffix = matches[3];
    number = _modifiedHexValue(matches[2], event);
    if (number !== null) {
      replacementString = prefix + number + suffix;
    }
  } else {
    matches = /(.*?)(-?(?:\d+(?:\.\d+)?|\.\d+))(.*)/.exec(wordString);
    if (matches && matches.length) {
      prefix = matches[1];
      suffix = matches[3];
      number = _modifiedFloatNumber(parseFloat(matches[2]), event);
      if (number !== null) {
        replacementString =
            customNumberHandler ? customNumberHandler(prefix, number, suffix) : prefix + number + suffix;
      }
    }
  }
  return replacementString;
}

/**
 * @param {!Event} event
 * @param {!Element} element
 * @param {function(string,string)=} finishHandler
 * @param {function(string)=} suggestionHandler
 * @param {function(string, number, string):string=} customNumberHandler
 * @return {boolean}
 */
function handleElementValueModifications(event, element, finishHandler, suggestionHandler, customNumberHandler) {
  /**
   * @return {?Range}
   * @suppressGlobalPropertiesCheck
   */
  function createRange() {
    return document.createRange();
  }

  const arrowKeyOrMouseWheelEvent =
      (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.type === 'mousewheel');
  const pageKeyPressed = (event.key === 'PageUp' || event.key === 'PageDown');
  if (!arrowKeyOrMouseWheelEvent && !pageKeyPressed) {
    return false;
  }

  const selection = element.getComponentSelection();
  if (!selection.rangeCount) {
    return false;
  }

  const selectionRange = selection.getRangeAt(0);
  if (!selectionRange.commonAncestorContainer.isSelfOrDescendant(element)) {
    return false;
  }

  const originalValue = element.textContent;
  const wordRange =
      selectionRange.startContainer.rangeOfWord(selectionRange.startOffset, StyleValueDelimiters, element);
  const wordString = wordRange.toString();

  if (suggestionHandler && suggestionHandler(wordString)) {
    return false;
  }

  const replacementString = createReplacementString(wordString, event, customNumberHandler);

  if (replacementString) {
    const replacementTextNode = createTextNode(replacementString);

    wordRange.deleteContents();
    wordRange.insertNode(replacementTextNode);

    const finalSelectionRange = createRange();
    finalSelectionRange.setStart(replacementTextNode, 0);
    finalSelectionRange.setEnd(replacementTextNode, replacementString.length);

    selection.removeAllRanges();
    selection.addRange(finalSelectionRange);

    event.handled = true;
    event.preventDefault();

    if (finishHandler) {
      finishHandler(originalValue, replacementString);
    }

    return true;
  }
  return false;
}

/**
 * @param {number} ms
 * @param {number=} precision
 * @return {string}
 */
Number.preciseMillisToString = function(ms, precision) {
  precision = precision || 0;
  const format = '%.' + precision + 'f\xa0ms';
  return Common.UIString(format, ms);
};

/** @type {!Common.UIStringFormat} */
const _microsFormat = new Common.UIStringFormat('%.0f\xa0\u03bcs');

/** @type {!Common.UIStringFormat} */
const _subMillisFormat = new Common.UIStringFormat('%.2f\xa0ms');

/** @type {!Common.UIStringFormat} */
const _millisFormat = new Common.UIStringFormat('%.0f\xa0ms');

/** @type {!Common.UIStringFormat} */
const _secondsFormat = new Common.UIStringFormat('%.2f\xa0s');

/** @type {!Common.UIStringFormat} */
const _minutesFormat = new Common.UIStringFormat('%.1f\xa0min');

/** @type {!Common.UIStringFormat} */
const _hoursFormat = new Common.UIStringFormat('%.1f\xa0hrs');

/** @type {!Common.UIStringFormat} */
const _daysFormat = new Common.UIStringFormat('%.1f\xa0days');

/**
 * @param {number} ms
 * @param {boolean=} higherResolution
 * @return {string}
 */
Number.millisToString = function(ms, higherResolution) {
  if (!isFinite(ms)) {
    return '-';
  }

  if (ms === 0) {
    return '0';
  }

  if (higherResolution && ms < 0.1) {
    return _microsFormat.format(ms * 1000);
  }
  if (higherResolution && ms < 1000) {
    return _subMillisFormat.format(ms);
  }
  if (ms < 1000) {
    return _millisFormat.format(ms);
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return _secondsFormat.format(seconds);
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return _minutesFormat.format(minutes);
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return _hoursFormat.format(hours);
  }

  const days = hours / 24;
  return _daysFormat.format(days);
};

/**
 * @param {number} seconds
 * @param {boolean=} higherResolution
 * @return {string}
 */
Number.secondsToString = function(seconds, higherResolution) {
  if (!isFinite(seconds)) {
    return '-';
  }
  return Number.millisToString(seconds * 1000, higherResolution);
};

/**
 * @param {number} bytes
 * @return {string}
 */
Number.bytesToString = function(bytes) {
  if (bytes < 1024) {
    return Common.UIString('%.0f\xa0B', bytes);
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 100) {
    return Common.UIString('%.1f\xa0KB', kilobytes);
  }
  if (kilobytes < 1024) {
    return Common.UIString('%.0f\xa0KB', kilobytes);
  }

  const megabytes = kilobytes / 1024;
  if (megabytes < 100) {
    return Common.UIString('%.1f\xa0MB', megabytes);
  } else {
    return Common.UIString('%.0f\xa0MB', megabytes);
  }
};

/**
 * @param {number} num
 * @return {string}
 */
Number.withThousandsSeparator = function(num) {
  let str = num + '';
  const re = /(\d+)(\d{3})/;
  while (str.match(re)) {
    str = str.replace(re, '$1\xa0$2');
  }  // \xa0 is a non-breaking space
  return str;
};

/**
 * @param {string} format
 * @param {?ArrayLike} substitutions
 * @return {!Element}
 */
function formatLocalized(format, substitutions) {
  const formatters = {s: substitution => substitution};
  /**
   * @param {!Element} a
   * @param {string|!Element} b
   * @return {!Element}
   */
  function append(a, b) {
    a.appendChild(typeof b === 'string' ? createTextNode(b) : b);
    return a;
  }
  return String.format(Common.UIString(format), substitutions, formatters, createElement('span'), append)
      .formattedResult;
}

/**
 * @return {string}
 */
function openLinkExternallyLabel() {
  return Common.UIString('Open in new tab');
}

/**
 * @return {string}
 */
function copyLinkAddressLabel() {
  return Common.UIString('Copy link address');
}

/**
 * @return {string}
 */
function anotherProfilerActiveLabel() {
  return Common.UIString('Another profiler is already active');
}

/**
 * @param {string|undefined} description
 * @return {string}
 */
function asyncStackTraceLabel(description) {
  if (description) {
    if (description === 'Promise.resolve') {
      return ls`Promise resolved (async)`;
    } else if (description === 'Promise.reject') {
      return ls`Promise rejected (async)`;
    }
    return ls`${description} (async)`;
  }
  return Common.UIString('Async Call');
}

/**
 * @param {!Element} element
 */
function installComponentRootStyles(element) {
  _injectCoreStyles(element);
  element.classList.add('platform-' + Host.platform());

  // Detect overlay scrollbar enable by checking for nonzero scrollbar width.
  if (!Host.isMac() && measuredScrollbarWidth(element.ownerDocument) === 0) {
    element.classList.add('overlay-scrollbar-enabled');
  }
}

/** @type {number} */
let _measuredScrollbarWidth;

/**
 * @param {?Document} document
 * @return {number}
 */
function measuredScrollbarWidth(document) {
  if (typeof _measuredScrollbarWidth === 'number') {
    return _measuredScrollbarWidth;
  }
  if (!document) {
    return 16;
  }
  const scrollDiv = document.createElement('div');
  scrollDiv.setAttribute('style', 'width: 100px; height: 100px; overflow: scroll;');
  document.body.appendChild(scrollDiv);
  _measuredScrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
  document.body.removeChild(scrollDiv);
  return _measuredScrollbarWidth;
}

/**
 * @param {!Element} element
 * @param {string=} cssFile
 * @param {boolean=} delegatesFocus
 * @return {!DocumentFragment}
 */
function createShadowRootWithCoreStyles(element, cssFile, delegatesFocus) {
  const shadowRoot = element.attachShadow({mode: 'open', delegatesFocus});
  _injectCoreStyles(shadowRoot);
  if (cssFile) {
    appendStyle(shadowRoot, cssFile);
  }
  shadowRoot.addEventListener('focus', _focusChanged.bind(UI), true);
  return shadowRoot;
}

/**
 * @param {!Element|!ShadowRoot} root
 */
function _injectCoreStyles(root) {
  appendStyle(root, 'ui/inspectorCommon.css');
  appendStyle(root, 'ui/textButton.css');
  UI.themeSupport.injectHighlightStyleSheets(root);
  UI.themeSupport.injectCustomStyleSheets(root);
}

/**
 * @param {!Document} document
 * @param {!Event} event
 */
function _windowFocused(document, event) {
  if (event.target.document.nodeType === Node.DOCUMENT_NODE) {
    document.body.classList.remove('inactive');
  }
  UI._keyboardFocus = true;
  const listener = () => {
    const activeElement = document.deepActiveElement();
    if (activeElement) {
      activeElement.removeAttribute('data-keyboard-focus');
    }
    UI._keyboardFocus = false;
  };
  document.defaultView.requestAnimationFrame(() => {
    UI._keyboardFocus = false;
    document.removeEventListener('mousedown', listener, true);
  });
  document.addEventListener('mousedown', listener, true);
}

/**
 * @param {!Document} document
 * @param {!Event} event
 */
function _windowBlurred(document, event) {
  if (event.target.document.nodeType === Node.DOCUMENT_NODE) {
    document.body.classList.add('inactive');
  }
}

/**
 * @param {!Event} event
 */
function _focusChanged(event) {
  const document = event.target && event.target.ownerDocument;
  const element = document ? document.deepActiveElement() : null;
  UI.Widget.focusWidgetForNode(element);
  UI.XWidget.focusWidgetForNode(element);
  if (!UI._keyboardFocus) {
    return;
  }

  UI.markAsFocusedByKeyboard(element);
}

UI.markAsFocusedByKeyboard = function(element) {
  element.setAttribute('data-keyboard-focus', 'true');
  element.addEventListener('blur', () => element.removeAttribute('data-keyboard-focus'), {once: true, capture: true});
};

/**
 * @unrestricted
 */
class ElementFocusRestorer {
  /**
   * @param {!Element} element
   */
  constructor(element) {
    this._element = element;
    this._previous = element.ownerDocument.deepActiveElement();
    element.focus();
  }

  restore() {
    if (!this._element) {
      return;
    }
    if (this._element.hasFocus() && this._previous) {
      this._previous.focus();
    }
    this._previous = null;
    this._element = null;
  }
}

/**
 * @param {!Element} element
 * @param {number} offset
 * @param {number} length
 * @param {!Array.<!Object>=} domChanges
 * @return {?Element}
 */
function highlightSearchResult(element, offset, length, domChanges) {
  const result = highlightSearchResults(element, [new TextUtils.SourceRange(offset, length)], domChanges);
  return result.length ? result[0] : null;
}

/**
 * @param {!Element} element
 * @param {!Array.<!TextUtils.SourceRange>} resultRanges
 * @param {!Array.<!Object>=} changes
 * @return {!Array.<!Element>}
 */
function highlightSearchResults(element, resultRanges, changes) {
  return highlightRangesWithStyleClass(element, resultRanges, highlightedSearchResultClassName, changes);
}

/**
 * @param {!Element} element
 * @param {string} className
 */
function runCSSAnimationOnce(element, className) {
  function animationEndCallback() {
    element.classList.remove(className);
    element.removeEventListener('webkitAnimationEnd', animationEndCallback, false);
  }

  if (element.classList.contains(className)) {
    element.classList.remove(className);
  }

  element.addEventListener('webkitAnimationEnd', animationEndCallback, false);
  element.classList.add(className);
}

/**
 * @param {!Element} element
 * @param {!Array.<!TextUtils.SourceRange>} resultRanges
 * @param {string} styleClass
 * @param {!Array.<!Object>=} changes
 * @return {!Array.<!Element>}
 */
function highlightRangesWithStyleClass(element, resultRanges, styleClass, changes) {
  changes = changes || [];
  const highlightNodes = [];
  const textNodes = element.childTextNodes();
  const lineText = textNodes
                       .map(function(node) {
                         return node.textContent;
                       })
                       .join('');
  const ownerDocument = element.ownerDocument;

  if (textNodes.length === 0) {
    return highlightNodes;
  }

  const nodeRanges = [];
  let rangeEndOffset = 0;
  for (let i = 0; i < textNodes.length; ++i) {
    const range = {};
    range.offset = rangeEndOffset;
    range.length = textNodes[i].textContent.length;
    rangeEndOffset = range.offset + range.length;
    nodeRanges.push(range);
  }

  let startIndex = 0;
  for (let i = 0; i < resultRanges.length; ++i) {
    const startOffset = resultRanges[i].offset;
    const endOffset = startOffset + resultRanges[i].length;

    while (startIndex < textNodes.length &&
           nodeRanges[startIndex].offset + nodeRanges[startIndex].length <= startOffset) {
      startIndex++;
    }
    let endIndex = startIndex;
    while (endIndex < textNodes.length && nodeRanges[endIndex].offset + nodeRanges[endIndex].length < endOffset) {
      endIndex++;
    }
    if (endIndex === textNodes.length) {
      break;
    }

    const highlightNode = ownerDocument.createElement('span');
    highlightNode.className = styleClass;
    highlightNode.textContent = lineText.substring(startOffset, endOffset);

    const lastTextNode = textNodes[endIndex];
    const lastText = lastTextNode.textContent;
    lastTextNode.textContent = lastText.substring(endOffset - nodeRanges[endIndex].offset);
    changes.push({node: lastTextNode, type: 'changed', oldText: lastText, newText: lastTextNode.textContent});

    if (startIndex === endIndex) {
      lastTextNode.parentElement.insertBefore(highlightNode, lastTextNode);
      changes.push({node: highlightNode, type: 'added', nextSibling: lastTextNode, parent: lastTextNode.parentElement});
      highlightNodes.push(highlightNode);

      const prefixNode =
          ownerDocument.createTextNode(lastText.substring(0, startOffset - nodeRanges[startIndex].offset));
      lastTextNode.parentElement.insertBefore(prefixNode, highlightNode);
      changes.push({node: prefixNode, type: 'added', nextSibling: highlightNode, parent: lastTextNode.parentElement});
    } else {
      const firstTextNode = textNodes[startIndex];
      const firstText = firstTextNode.textContent;
      const anchorElement = firstTextNode.nextSibling;

      firstTextNode.parentElement.insertBefore(highlightNode, anchorElement);
      changes.push(
          {node: highlightNode, type: 'added', nextSibling: anchorElement, parent: firstTextNode.parentElement});
      highlightNodes.push(highlightNode);

      firstTextNode.textContent = firstText.substring(0, startOffset - nodeRanges[startIndex].offset);
      changes.push({node: firstTextNode, type: 'changed', oldText: firstText, newText: firstTextNode.textContent});

      for (let j = startIndex + 1; j < endIndex; j++) {
        const textNode = textNodes[j];
        const text = textNode.textContent;
        textNode.textContent = '';
        changes.push({node: textNode, type: 'changed', oldText: text, newText: textNode.textContent});
      }
    }
    startIndex = endIndex;
    nodeRanges[startIndex].offset = endOffset;
    nodeRanges[startIndex].length = lastTextNode.textContent.length;
  }
  return highlightNodes;
}

function applyDomChanges(domChanges) {
  for (let i = 0, size = domChanges.length; i < size; ++i) {
    const entry = domChanges[i];
    switch (entry.type) {
      case 'added':
        entry.parent.insertBefore(entry.node, entry.nextSibling);
        break;
      case 'changed':
        entry.node.textContent = entry.newText;
        break;
    }
  }
}

function revertDomChanges(domChanges) {
  for (let i = domChanges.length - 1; i >= 0; --i) {
    const entry = domChanges[i];
    switch (entry.type) {
      case 'added':
        entry.node.remove();
        break;
      case 'changed':
        entry.node.textContent = entry.oldText;
        break;
    }
  }
}

/**
 * @param {!Element} element
 * @param {?Element=} containerElement
 * @return {!UI.Size}
 */
function measurePreferredSize(element, containerElement) {
  const oldParent = element.parentElement;
  const oldNextSibling = element.nextSibling;
  containerElement = containerElement || element.ownerDocument.body;
  containerElement.appendChild(element);
  element.positionAt(0, 0);
  const result = element.getBoundingClientRect();

  element.positionAt(undefined, undefined);
  if (oldParent) {
    oldParent.insertBefore(element, oldNextSibling);
  } else {
    element.remove();
  }
  return new UI.Size(result.width, result.height);
}

/**
 * @unrestricted
 */
class InvokeOnceHandlers {
  /**
   * @param {boolean} autoInvoke
   */
  constructor(autoInvoke) {
    this._handlers = null;
    this._autoInvoke = autoInvoke;
  }

  /**
   * @param {!Object} object
   * @param {function()} method
   */
  add(object, method) {
    if (!this._handlers) {
      this._handlers = new Map();
      if (this._autoInvoke) {
        this.scheduleInvoke();
      }
    }
    let methods = this._handlers.get(object);
    if (!methods) {
      methods = new Set();
      this._handlers.set(object, methods);
    }
    methods.add(method);
  }

  /**
   * @suppressGlobalPropertiesCheck
   */
  scheduleInvoke() {
    if (this._handlers) {
      requestAnimationFrame(this._invoke.bind(this));
    }
  }

  _invoke() {
    const handlers = this._handlers;
    this._handlers = null;
    const keys = handlers.keysArray();
    for (let i = 0; i < keys.length; ++i) {
      const object = keys[i];
      const methods = handlers.get(object).valuesArray();
      for (let j = 0; j < methods.length; ++j) {
        methods[j].call(object);
      }
    }
  }
}

let _coalescingLevel = 0;
let _postUpdateHandlers = null;

function startBatchUpdate() {
  if (!_coalescingLevel++) {
    _postUpdateHandlers = new InvokeOnceHandlers(false);
  }
}

function endBatchUpdate() {
  if (--_coalescingLevel) {
    return;
  }
  _postUpdateHandlers.scheduleInvoke();
  _postUpdateHandlers = null;
}

/**
 * @param {!Object} object
 * @param {function()} method
 */
function invokeOnceAfterBatchUpdate(object, method) {
  if (!_postUpdateHandlers) {
    _postUpdateHandlers = new InvokeOnceHandlers(true);
  }
  _postUpdateHandlers.add(object, method);
}

/**
 * @param {!Window} window
 * @param {!Function} func
 * @param {!Array.<{from:number, to:number}>} params
 * @param {number} duration
 * @param {function()=} animationComplete
 * @return {function()}
 */
function animateFunction(window, func, params, duration, animationComplete) {
  const start = window.performance.now();
  let raf = window.requestAnimationFrame(animationStep);

  function animationStep(timestamp) {
    const progress = Number.constrain((timestamp - start) / duration, 0, 1);
    func(...params.map(p => p.from + (p.to - p.from) * progress));
    if (progress < 1) {
      raf = window.requestAnimationFrame(animationStep);
    } else if (animationComplete) {
      animationComplete();
    }
  }

  return () => window.cancelAnimationFrame(raf);
}

/**
 * @unrestricted
 */
class LongClickController extends Common.Object {
  /**
   * @param {!Element} element
   * @param {function(!Event)} callback
   */
  constructor(element, callback) {
    super();
    this._element = element;
    this._callback = callback;
    this._enable();
  }

  reset() {
    if (this._longClickInterval) {
      clearInterval(this._longClickInterval);
      delete this._longClickInterval;
    }
  }

  _enable() {
    if (this._longClickData) {
      return;
    }
    const boundMouseDown = mouseDown.bind(this);
    const boundMouseUp = mouseUp.bind(this);
    const boundReset = this.reset.bind(this);

    this._element.addEventListener('mousedown', boundMouseDown, false);
    this._element.addEventListener('mouseout', boundReset, false);
    this._element.addEventListener('mouseup', boundMouseUp, false);
    this._element.addEventListener('click', boundReset, true);

    this._longClickData = {mouseUp: boundMouseUp, mouseDown: boundMouseDown, reset: boundReset};

    /**
     * @param {!Event} e
     * @this {LongClickController}
     */
    function mouseDown(e) {
      if (e.which !== 1) {
        return;
      }
      const callback = this._callback;
      this._longClickInterval = setTimeout(callback.bind(null, e), 200);
    }

    /**
     * @param {!Event} e
     * @this {LongClickController}
     */
    function mouseUp(e) {
      if (e.which !== 1) {
        return;
      }
      this.reset();
    }
  }

  dispose() {
    if (!this._longClickData) {
      return;
    }
    this._element.removeEventListener('mousedown', this._longClickData.mouseDown, false);
    this._element.removeEventListener('mouseout', this._longClickData.reset, false);
    this._element.removeEventListener('mouseup', this._longClickData.mouseUp, false);
    this._element.addEventListener('click', this._longClickData.reset, true);
    delete this._longClickData;
  }
}

/**
 * @param {!Document} document
 * @param {!Common.Setting} themeSetting
 */
function initializeUIUtils(document, themeSetting) {
  document.body.classList.toggle('inactive', !document.hasFocus());
  document.defaultView.addEventListener('focus', _windowFocused.bind(UI, document), false);
  document.defaultView.addEventListener('blur', _windowBlurred.bind(UI, document), false);
  document.addEventListener('focus', _focusChanged.bind(UI), true);
  document.addEventListener('keydown', event => {
    UI._keyboardFocus = true;
    document.defaultView.requestAnimationFrame(() => void(UI._keyboardFocus = false));
  }, true);

  if (!UI.themeSupport) {
    UI.themeSupport = new ThemeSupport(themeSetting);
  }
  UI.themeSupport.applyTheme(document);

  const body = /** @type {!Element} */ (document.body);
  appendStyle(body, 'ui/inspectorStyle.css');
  UI.GlassPane.setContainer(/** @type {!Element} */ (document.body));
}

/**
 * @param {string} name
 * @return {string}
 */
function beautifyFunctionName(name) {
  return name || Common.UIString('(anonymous)');
}

/**
 * @param {string} localName
 * @param {string} typeExtension
 * @param {function(new:HTMLElement, *)} definition
 * @return {function()}
 * @suppressGlobalPropertiesCheck
 */
function registerCustomElement(localName, typeExtension, definition) {
  self.customElements.define(typeExtension, class extends definition {
    constructor() {
      super();
      // TODO(einbinder) convert to classes and custom element tags
      this.setAttribute('is', typeExtension);
    }
  }, {extends: localName});
  return () => createElement(localName, typeExtension);
}

/**
 * @param {string} text
 * @param {function(!Event)=} clickHandler
 * @param {string=} className
 * @param {boolean=} primary
 * @return {!Element}
 */
function createTextButton(text, clickHandler, className, primary) {
  const element = createElementWithClass('button', className || '');
  element.textContent = text;
  element.classList.add('text-button');
  if (primary) {
    element.classList.add('primary-button');
  }
  if (clickHandler) {
    element.addEventListener('click', clickHandler, false);
  }
  element.type = 'button';
  return element;
}

/**
 * @param {string=} className
 * @param {string=} type
 * @return {!Element}
 */
function createInput(className, type) {
  const element = createElementWithClass('input', className || '');
  element.spellcheck = false;
  element.classList.add('harmony-input');
  if (type) {
    element.type = type;
  }
  return element;
}

/**
 * @param {string} title
 * @param {string=} className
 * @param {!Element=} associatedControl
 * @return {!Element}
 */
function createLabel(title, className, associatedControl) {
  const element = createElementWithClass('label', className || '');
  element.textContent = title;
  if (associatedControl) {
    UI.ARIAUtils.bindLabelToControl(element, associatedControl);
  }

  return element;
}

/**
 * @param {string} name
 * @param {string} title
 * @param {boolean=} checked
 * @return {!Element}
 */
function createRadioLabel(name, title, checked) {
  const element = createElement('span', 'dt-radio');
  element.radioElement.name = name;
  element.radioElement.checked = !!checked;
  element.labelElement.createTextChild(title);
  return element;
}

/**
 * @param {string} title
 * @param {string} iconClass
 * @return {!Element}
 */
function createIconLabel(title, iconClass) {
  const element = createElement('span', 'dt-icon-label');
  element.createChild('span').textContent = title;
  element.type = iconClass;
  return element;
}

/**
 * @return {!Element}
 * @param {number} min
 * @param {number} max
 * @param {number} tabIndex
 */
function createSlider(min, max, tabIndex) {
  const element = createElement('span', 'dt-slider');
  element.sliderElement.min = min;
  element.sliderElement.max = max;
  element.sliderElement.step = 1;
  element.sliderElement.tabIndex = tabIndex;
  return element;
}

/**
 * @param {!Node} node
 * @param {string} cssFile
 * @suppressGlobalPropertiesCheck
 */
function appendStyle(node, cssFile) {
  const content = Root.Runtime.cachedResources[cssFile] || '';
  if (!content) {
    console.error(cssFile + ' not preloaded. Check module.json');
  }
  let styleElement = createElement('style');
  styleElement.textContent = content;
  node.appendChild(styleElement);

  const themeStyleSheet = UI.themeSupport.themeStyleSheet(cssFile, content);
  if (themeStyleSheet) {
    styleElement = createElement('style');
    styleElement.textContent = themeStyleSheet + '\n' + Root.Runtime.resolveSourceURL(cssFile + '.theme');
    node.appendChild(styleElement);
  }
}

class CheckboxLabel extends HTMLSpanElement {
  constructor() {
    super();
    /** @type {!DocumentFragment} */
    this._shadowRoot;
    /** @type {!HTMLInputElement} */
    this.checkboxElement;
    /** @type {!Element} */
    this.textElement;
    CheckboxLabel._lastId = (CheckboxLabel._lastId || 0) + 1;
    const id = 'ui-checkbox-label' + CheckboxLabel._lastId;
    this._shadowRoot = createShadowRootWithCoreStyles(this, 'ui/checkboxTextLabel.css');
    this.checkboxElement = /** @type {!HTMLInputElement} */ (this._shadowRoot.createChild('input'));
    this.checkboxElement.type = 'checkbox';
    this.checkboxElement.setAttribute('id', id);
    this.textElement = this._shadowRoot.createChild('label', 'dt-checkbox-text');
    this.textElement.setAttribute('for', id);
    this._shadowRoot.createChild('slot');
  }

  /**
   * @param {string=} title
   * @param {boolean=} checked
   * @param {string=} subtitle
   * @return {!CheckboxLabel}
   */
  static create(title, checked, subtitle) {
    if (!CheckboxLabel._constructor) {
      CheckboxLabel._constructor = registerCustomElement('span', 'dt-checkbox', CheckboxLabel);
    }
    const element = /** @type {!CheckboxLabel} */ (CheckboxLabel._constructor());
    element.checkboxElement.checked = !!checked;
    if (title !== undefined) {
      element.textElement.textContent = title;
      if (subtitle !== undefined) {
        element.textElement.createChild('div', 'dt-checkbox-subtitle').textContent = subtitle;
      }
    }
    return element;
  }

  /**
   * @param {string} color
   * @this {Element}
   */
  set backgroundColor(color) {
    this.checkboxElement.classList.add('dt-checkbox-themed');
    this.checkboxElement.style.backgroundColor = color;
  }

  /**
   * @param {string} color
   * @this {Element}
   */
  set checkColor(color) {
    this.checkboxElement.classList.add('dt-checkbox-themed');
    const stylesheet = createElement('style');
    stylesheet.textContent = 'input.dt-checkbox-themed:checked:after { background-color: ' + color + '}';
    this._shadowRoot.appendChild(stylesheet);
  }

  /**
   * @param {string} color
   * @this {Element}
   */
  set borderColor(color) {
    this.checkboxElement.classList.add('dt-checkbox-themed');
    this.checkboxElement.style.borderColor = color;
  }
}

(function() {
let labelId = 0;
registerCustomElement('span', 'dt-radio', class extends HTMLSpanElement {
  constructor() {
    super();
    this.radioElement = this.createChild('input', 'dt-radio-button');
    this.labelElement = this.createChild('label');

    const id = 'dt-radio-button-id' + (++labelId);
    this.radioElement.id = id;
    this.radioElement.type = 'radio';
    this.labelElement.htmlFor = id;
    const root = createShadowRootWithCoreStyles(this, 'ui/radioButton.css');
    root.createChild('slot');
    this.addEventListener('click', radioClickHandler, false);
  }
});

/**
   * @param {!Event} event
   * @suppressReceiverCheck
   * @this {Element}
   */
function radioClickHandler(event) {
  if (this.radioElement.checked || this.radioElement.disabled) {
    return;
  }
  this.radioElement.checked = true;
  this.radioElement.dispatchEvent(new Event('change'));
}

registerCustomElement('span', 'dt-icon-label', class extends HTMLSpanElement {
  constructor() {
    super();
    const root = createShadowRootWithCoreStyles(this);
    this._iconElement = UI.Icon.create();
    this._iconElement.style.setProperty('margin-right', '4px');
    root.appendChild(this._iconElement);
    root.createChild('slot');
  }

  /**
     * @param {string} type
     * @this {Element}
     */
  set type(type) {
    this._iconElement.setIconType(type);
  }
});

registerCustomElement('span', 'dt-slider', class extends HTMLSpanElement {
  constructor() {
    super();
    const root = createShadowRootWithCoreStyles(this, 'ui/slider.css');
    this.sliderElement = createElementWithClass('input', 'dt-range-input');
    this.sliderElement.type = 'range';
    root.appendChild(this.sliderElement);
  }

  /**
     * @param {number} amount
     * @this {Element}
     */
  set value(amount) {
    this.sliderElement.value = amount;
  }

  /**
     * @this {Element}
     */
  get value() {
    return this.sliderElement.value;
  }
});

registerCustomElement('span', 'dt-small-bubble', class extends HTMLSpanElement {
  constructor() {
    super();
    const root = createShadowRootWithCoreStyles(this, 'ui/smallBubble.css');
    this._textElement = root.createChild('div');
    this._textElement.className = 'info';
    this._textElement.createChild('slot');
  }

  /**
     * @param {string} type
     * @this {Element}
     */
  set type(type) {
    this._textElement.className = type;
  }
});

registerCustomElement('div', 'dt-close-button', class extends HTMLDivElement {
  constructor() {
    super();
    const root = createShadowRootWithCoreStyles(this, 'ui/closeButton.css');
    this._buttonElement = root.createChild('div', 'close-button');
    UI.ARIAUtils.setAccessibleName(this._buttonElement, ls`Close`);
    UI.ARIAUtils.markAsButton(this._buttonElement);
    const regularIcon = UI.Icon.create('smallicon-cross', 'default-icon');
    this._hoverIcon = UI.Icon.create('mediumicon-red-cross-hover', 'hover-icon');
    this._activeIcon = UI.Icon.create('mediumicon-red-cross-active', 'active-icon');
    this._buttonElement.appendChild(regularIcon);
    this._buttonElement.appendChild(this._hoverIcon);
    this._buttonElement.appendChild(this._activeIcon);
  }

  /**
     * @param {boolean} gray
     * @this {Element}
     */
  set gray(gray) {
    if (gray) {
      this._hoverIcon.setIconType('mediumicon-gray-cross-hover');
      this._activeIcon.setIconType('mediumicon-gray-cross-active');
    } else {
      this._hoverIcon.setIconType('mediumicon-red-cross-hover');
      this._activeIcon.setIconType('mediumicon-red-cross-active');
    }
  }

  /**
   * @param {string} name
   * @this {Element}
   */
  setAccessibleName(name) {
    UI.ARIAUtils.setAccessibleName(this._buttonElement, name);
  }

  /**
   * @param {boolean} tabbable
   * @this {Element}
   */
  setTabbable(tabbable) {
    if (tabbable) {
      this._buttonElement.tabIndex = 0;
    } else {
      this._buttonElement.tabIndex = -1;
    }
  }
});
})();

/**
 * @param {!Element} input
 * @param {function(string)} apply
 * @param {function(string):{valid: boolean, errorMessage: (string|undefined)}} validate
 * @param {boolean} numeric
 * @param {number=} modifierMultiplier
 * @return {function(string)}
 */
function bindInput(input, apply, validate, numeric, modifierMultiplier) {
  input.addEventListener('change', onChange, false);
  input.addEventListener('input', onInput, false);
  input.addEventListener('keydown', onKeyDown, false);
  input.addEventListener('focus', input.select.bind(input), false);

  function onInput() {
    input.classList.toggle('error-input', !validate(input.value));
  }

  function onChange() {
    const {valid} = validate(input.value);
    input.classList.toggle('error-input', !valid);
    if (valid) {
      apply(input.value);
    }
  }

  /**
   * @param {!Event} event
   */
  function onKeyDown(event) {
    if (isEnterKey(event)) {
      const {valid} = validate(input.value);
      if (valid) {
        apply(input.value);
      }
      event.preventDefault();
      return;
    }

    if (!numeric) {
      return;
    }

    const value = _modifiedFloatNumber(parseFloat(input.value), event, modifierMultiplier);
    const stringValue = value ? String(value) : '';
    const {valid} = validate(stringValue);
    if (!valid || !value) {
      return;
    }

    input.value = stringValue;
    apply(input.value);
    event.preventDefault();
  }

  /**
   * @param {string} value
   */
  function setValue(value) {
    if (value === input.value) {
      return;
    }
    const {valid} = validate(value);
    input.classList.toggle('error-input', !valid);
    input.value = value;
  }

  return setValue;
}

/**
 * @param {!CanvasRenderingContext2D} context
 * @param {string} text
 * @param {number} maxWidth
 * @param {function(string, number):string} trimFunction
 * @return {string}
 */
function trimText(context, text, maxWidth, trimFunction) {
  const maxLength = 200;
  if (maxWidth <= 10) {
    return '';
  }
  if (text.length > maxLength) {
    text = trimFunction(text, maxLength);
  }
  const textWidth = measureTextWidth(context, text);
  if (textWidth <= maxWidth) {
    return text;
  }

  let l = 0;
  let r = text.length;
  let lv = 0;
  let rv = textWidth;
  while (l < r && lv !== rv && lv !== maxWidth) {
    const m = Math.ceil(l + (r - l) * (maxWidth - lv) / (rv - lv));
    const mv = measureTextWidth(context, trimFunction(text, m));
    if (mv <= maxWidth) {
      l = m;
      lv = mv;
    } else {
      r = m - 1;
      rv = mv;
    }
  }
  text = trimFunction(text, l);
  return text !== '\u2026' ? text : '';
}

/**
 * @param {!CanvasRenderingContext2D} context
 * @param {string} text
 * @param {number} maxWidth
 * @return {string}
 */
function trimTextMiddle(context, text, maxWidth) {
  return trimText(context, text, maxWidth, (text, width) => text.trimMiddle(width));
}

/**
 * @param {!CanvasRenderingContext2D} context
 * @param {string} text
 * @param {number} maxWidth
 * @return {string}
 */
function trimTextEnd(context, text, maxWidth) {
  return trimText(context, text, maxWidth, (text, width) => text.trimEndWithMaxLength(width));
}

/**
 * @param {!CanvasRenderingContext2D} context
 * @param {string} text
 * @return {number}
 */
function measureTextWidth(context, text) {
  const maxCacheableLength = 200;
  if (text.length > maxCacheableLength) {
    return context.measureText(text).width;
  }

  let widthCache = measureTextWidth._textWidthCache;
  if (!widthCache) {
    widthCache = new Map();
    measureTextWidth._textWidthCache = widthCache;
  }
  const font = context.font;
  let textWidths = widthCache.get(font);
  if (!textWidths) {
    textWidths = new Map();
    widthCache.set(font, textWidths);
  }
  let width = textWidths.get(text);
  if (!width) {
    width = context.measureText(text).width;
    textWidths.set(text, width);
  }
  return width;
}

/**
 * @unrestricted
 */
class ThemeSupport {
  /**
   * @param {!Common.Setting} setting
   */
  constructor(setting) {
    const systemPreferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
    this._themeName = setting.get() === 'systemPreferred' ? systemPreferredTheme : setting.get();
    this._themableProperties = new Set([
      'color', 'box-shadow', 'text-shadow', 'outline-color', 'background-image', 'background-color',
      'border-left-color', 'border-right-color', 'border-top-color', 'border-bottom-color', '-webkit-border-image',
      'fill', 'stroke'
    ]);
    /** @type {!Map<string, string>} */
    this._cachedThemePatches = new Map();
    this._setting = setting;
    this._customSheets = new Set();
  }

  /**
   * @return {boolean}
   */
  hasTheme() {
    return this._themeName !== 'default';
  }

  /**
   * @return {string}
   */
  themeName() {
    return this._themeName;
  }

  /**
   * @param {!Element|!ShadowRoot} element
   */
  injectHighlightStyleSheets(element) {
    this._injectingStyleSheet = true;
    appendStyle(element, 'ui/inspectorSyntaxHighlight.css');
    if (this._themeName === 'dark') {
      appendStyle(element, 'ui/inspectorSyntaxHighlightDark.css');
    }
    this._injectingStyleSheet = false;
  }

   /**
   * @param {!Element|!ShadowRoot} element
   */
  injectCustomStyleSheets(element) {
    for (const sheet of this._customSheets){
      const styleElement = createElement('style');
      styleElement.textContent = sheet;
      element.appendChild(styleElement);
    }
  }

  /**
   * @param {string} sheetText
   */
  addCustomStylesheet(sheetText) {
    this._customSheets.add(sheetText);
  }

  /**
   * @param {!Document} document
   */
  applyTheme(document) {
    if (!this.hasTheme()) {
      return;
    }

    if (this._themeName === 'dark') {
      document.documentElement.classList.add('-theme-with-dark-background');
    }

    const styleSheets = document.styleSheets;
    const result = [];
    for (let i = 0; i < styleSheets.length; ++i) {
      result.push(this._patchForTheme(styleSheets[i].href, styleSheets[i]));
    }
    result.push('/*# sourceURL=inspector.css.theme */');

    const styleElement = createElement('style');
    styleElement.textContent = result.join('\n');
    document.head.appendChild(styleElement);
  }

  /**
   * @param {string} id
   * @param {string} text
   * @return {string}
   * @suppressGlobalPropertiesCheck
   */
  themeStyleSheet(id, text) {
    if (!this.hasTheme() || this._injectingStyleSheet) {
      return '';
    }

    let patch = this._cachedThemePatches.get(id);
    if (!patch) {
      const styleElement = createElement('style');
      styleElement.textContent = text;
      document.body.appendChild(styleElement);
      patch = this._patchForTheme(id, styleElement.sheet);
      document.body.removeChild(styleElement);
    }
    return patch;
  }

  /**
   * @param {string} id
   * @param {!StyleSheet} styleSheet
   * @return {string}
   */
  _patchForTheme(id, styleSheet) {
    const cached = this._cachedThemePatches.get(id);
    if (cached) {
      return cached;
    }

    try {
      const rules = styleSheet.cssRules;
      const result = [];
      for (let j = 0; j < rules.length; ++j) {
        if (rules[j] instanceof CSSImportRule) {
          result.push(this._patchForTheme(rules[j].styleSheet.href, rules[j].styleSheet));
          continue;
        }
        const output = [];
        const style = rules[j].style;
        const selectorText = rules[j].selectorText;
        for (let i = 0; style && i < style.length; ++i) {
          this._patchProperty(selectorText, style, style[i], output);
        }
        if (output.length) {
          result.push(rules[j].selectorText + '{' + output.join('') + '}');
        }
      }

      const fullText = result.join('\n');
      this._cachedThemePatches.set(id, fullText);
      return fullText;
    } catch (e) {
      this._setting.set('default');
      return '';
    }
  }

  /**
   * @param {string} selectorText
   * @param {!CSSStyleDeclaration} style
   * @param {string} name
   * @param {!Array<string>} output
   *
   * Theming API is primarily targeted at making dark theme look good.
   * - If rule has ".-theme-preserve" in selector, it won't be affected.
   * - One can create specializations for dark themes via body.-theme-with-dark-background selector in host context.
   */
  _patchProperty(selectorText, style, name, output) {
    if (!this._themableProperties.has(name)) {
      return;
    }

    const value = style.getPropertyValue(name);
    if (!value || value === 'none' || value === 'inherit' || value === 'initial' || value === 'transparent') {
      return;
    }
    if (name === 'background-image' && value.indexOf('gradient') === -1) {
      return;
    }

    if (selectorText.indexOf('-theme-') !== -1) {
      return;
    }

    let colorUsage = ThemeSupport.ColorUsage.Unknown;
    if (name.indexOf('background') === 0 || name.indexOf('border') === 0) {
      colorUsage |= ThemeSupport.ColorUsage.Background;
    }
    if (name.indexOf('background') === -1) {
      colorUsage |= ThemeSupport.ColorUsage.Foreground;
    }

    output.push(name);
    output.push(':');
    const items = value.replace(Common.Color.Regex, '\0$1\0').split('\0');
    for (let i = 0; i < items.length; ++i) {
      output.push(this.patchColorText(items[i], /** @type {!ThemeSupport.ColorUsage} */ (colorUsage)));
    }
    if (style.getPropertyPriority(name)) {
      output.push(' !important');
    }
    output.push(';');
  }

  /**
   * @param {string} text
   * @param {!ThemeSupport.ColorUsage} colorUsage
   * @return {string}
   */
  patchColorText(text, colorUsage) {
    const color = Common.Color.parse(text);
    if (!color) {
      return text;
    }
    const outColor = this.patchColor(color, colorUsage);
    let outText = outColor.asString(null);
    if (!outText) {
      outText = outColor.asString(outColor.hasAlpha() ? Common.Color.Format.RGBA : Common.Color.Format.RGB);
    }
    return outText || text;
  }

  /**
   * @param {!Common.Color} color
   * @param {!ThemeSupport.ColorUsage} colorUsage
   * @return {!Common.Color}
   */
  patchColor(color, colorUsage) {
    const hsla = color.hsla();
    this._patchHSLA(hsla, colorUsage);
    const rgba = [];
    Common.Color.hsl2rgb(hsla, rgba);
    return new Common.Color(rgba, color.format());
  }

  /**
   * @param {!Array<number>} hsla
   * @param {!ThemeSupport.ColorUsage} colorUsage
   */
  _patchHSLA(hsla, colorUsage) {
    const hue = hsla[0];
    const sat = hsla[1];
    let lit = hsla[2];
    const alpha = hsla[3];

    switch (this._themeName) {
      case 'dark':
        const minCap = colorUsage & ThemeSupport.ColorUsage.Background ? 0.14 : 0;
        const maxCap = colorUsage & ThemeSupport.ColorUsage.Foreground ? 0.9 : 1;
        lit = 1 - lit;
        if (lit < minCap * 2) {
          lit = minCap + lit / 2;
        } else if (lit > 2 * maxCap - 1) {
          lit = maxCap - 1 / 2 + lit / 2;
        }

        break;
    }
    hsla[0] = Number.constrain(hue, 0, 1);
    hsla[1] = Number.constrain(sat, 0, 1);
    hsla[2] = Number.constrain(lit, 0, 1);
    hsla[3] = Number.constrain(alpha, 0, 1);
  }
}

/**
 * @enum {number}
 */
ThemeSupport.ColorUsage = {
  Unknown: 0,
  Foreground: 1 << 0,
  Background: 1 << 1,
};

/**
 * @param {string} article
 * @param {string} title
 * @return {!Element}
 */
function createDocumentationLink(article, title) {
  return UI.XLink.create('https://developers.google.com/web/tools/chrome-devtools/' + article, title);
}

/**
 * @param {string} url
 * @return {!Promise<?Image>}
 */
function loadImage(url) {
  return new Promise(fulfill => {
    const image = new Image();
    image.addEventListener('load', () => fulfill(image));
    image.addEventListener('error', () => fulfill(null));
    image.src = url;
  });
}

/**
 * @param {?string} data
 * @return {!Promise<?Image>}
 */
function loadImageFromData(data) {
  return data ? loadImage('data:image/jpg;base64,' + data) : Promise.resolve(null);
}

/**
 * @param {function(!File)} callback
 * @return {!Node}
 */
function createFileSelectorElement(callback) {
  const fileSelectorElement = createElement('input');
  fileSelectorElement.type = 'file';
  fileSelectorElement.style.display = 'none';
  fileSelectorElement.setAttribute('tabindex', -1);
  fileSelectorElement.onchange = onChange;
  function onChange(event) {
    callback(fileSelectorElement.files[0]);
  }
  return fileSelectorElement;
}

/**
 * @const
 * @type {number}
 */
const MaxLengthForDisplayedURLs = 150;

class MessageDialog {
  /**
   * @param {string} message
   * @param {!Document|!Element=} where
   * @return {!Promise}
   */
  static async show(message, where) {
    const dialog = new UI.Dialog();
    dialog.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
    dialog.setDimmed(true);
    const shadowRoot = createShadowRootWithCoreStyles(dialog.contentElement, 'ui/confirmDialog.css');
    const content = shadowRoot.createChild('div', 'widget');
    await new Promise(resolve => {
      const okButton = createTextButton(Common.UIString('OK'), resolve, '', true);
      content.createChild('div', 'message').createChild('span').textContent = message;
      content.createChild('div', 'button').appendChild(okButton);
      dialog.setOutsideClickCallback(event => {
        event.consume();
        resolve();
      });
      dialog.show(where);
      okButton.focus();
    });
    dialog.hide();
  }
}

class ConfirmDialog {
  /**
   * @param {string} message
   * @param {!Document|!Element=} where
   * @return {!Promise<boolean>}
   */
  static async show(message, where) {
    const dialog = new UI.Dialog();
    dialog.setSizeBehavior(UI.GlassPane.SizeBehavior.MeasureContent);
    dialog.setDimmed(true);
    const shadowRoot = createShadowRootWithCoreStyles(dialog.contentElement, 'ui/confirmDialog.css');
    const content = shadowRoot.createChild('div', 'widget');
    content.createChild('div', 'message').createChild('span').textContent = message;
    const buttonsBar = content.createChild('div', 'button');
    const result = await new Promise(resolve => {
      buttonsBar.appendChild(createTextButton(Common.UIString('OK'), () => resolve(true), '', true));
      buttonsBar.appendChild(createTextButton(Common.UIString('Cancel'), () => resolve(false)));
      dialog.setOutsideClickCallback(event => {
        event.consume();
        resolve(false);
      });
      dialog.show(where);
    });
    dialog.hide();
    return result;
  }
}

/**
 * @param {!UI.ToolbarButton} toolbarButton
 * @return {!Element}
 */
function createInlineButton(toolbarButton) {
  const element = createElement('span');
  const shadowRoot = createShadowRootWithCoreStyles(element, 'ui/inlineButton.css');
  element.classList.add('inline-button');
  const toolbar = new UI.Toolbar('');
  toolbar.appendToolbarItem(toolbarButton);
  shadowRoot.appendChild(toolbar.element);
  return element;
}

/**
 * @param {string} text
 * @param {number} maxLength
 * @return {!DocumentFragment}
 */
function createExpandableText(text, maxLength) {
  const clickHandler = () => {
    if (expandElement.parentElement) {
      expandElement.parentElement.insertBefore(createTextNode(text.slice(maxLength)), expandElement);
    }
    expandElement.remove();
  };
  const fragment = createDocumentFragment();
  fragment.textContent = text.slice(0, maxLength);
  const expandElement = fragment.createChild('span');
  const totalBytes = Number.bytesToString(2 * text.length);
  if (text.length < 10000000) {
    expandElement.setAttribute('data-text', ls`Show more (${totalBytes})`);
    expandElement.classList.add('expandable-inline-button');
    expandElement.addEventListener('click', clickHandler);
    expandElement.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        clickHandler();
      }
    });
    UI.ARIAUtils.markAsButton(expandElement);

  } else {
    expandElement.setAttribute('data-text', ls`long text was truncated (${totalBytes})`);
    expandElement.classList.add('undisplayable-text');
  }

  const copyButton = fragment.createChild('span', 'expandable-inline-button');
  copyButton.setAttribute('data-text', ls`Copy`);
  copyButton.addEventListener('click', () => {
    Host.InspectorFrontendHost.copyText(text);
  });
  copyButton.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      Host.InspectorFrontendHost.copyText(text);
    }
  });
  UI.ARIAUtils.markAsButton(copyButton);
  return fragment;
}

/**
 * @interface
 */
class Renderer {
  /**
   * @param {!Object} object
   * @param {!UI.Renderer.Options=} options
   * @return {!Promise<?{node: !Node, tree: ?UI.TreeOutline}>}
   */
  render(object, options) {
  }
}

/**
   * @param {!Object} object
   * @param {!UI.Renderer.Options=} options
   * @return {!Promise<?{node: !Node, tree: ?UI.TreeOutline}>}
   */
Renderer.render = async function(object, options) {
  if (!object) {
    throw new Error('Can\'t render ' + object);
  }
  const renderer = await self.runtime.extension(Renderer, object).instance();
  return renderer ? renderer.render(object, options || {}) : null;
};

/**
 * @param {number} timestamp
 * @param {boolean} full
 * @return {string}
 */
function formatTimestamp(timestamp, full) {
  const date = new Date(timestamp);
  const yymmdd = date.getFullYear() + '-' + leadZero(date.getMonth() + 1, 2) + '-' + leadZero(date.getDate(), 2);
  const hhmmssfff = leadZero(date.getHours(), 2) + ':' + leadZero(date.getMinutes(), 2) + ':' +
      leadZero(date.getSeconds(), 2) + '.' + leadZero(date.getMilliseconds(), 3);
  return full ? (yymmdd + ' ' + hhmmssfff) : hhmmssfff;

  /**
   * @param {number} value
   * @param {number} length
   * @return {string}
   */
  function leadZero(value, length) {
    const valueString = String(value);
    return valueString.padStart(length, '0');
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @type {?ThemeSupport} */
UI.themeSupport;

UI.highlightedSearchResultClassName = highlightedSearchResultClassName;
UI.highlightedCurrentSearchResultClassName = highlightedCurrentSearchResultClassName;
UI._numberRegex = _numberRegex;
UI.StyleValueDelimiters = StyleValueDelimiters;
UI._coalescingLevel = _coalescingLevel;
UI._postUpdateHandlers = _postUpdateHandlers;
UI.MaxLengthForDisplayedURLs = MaxLengthForDisplayedURLs;

/** @constructor */
UI.ElementFocusRestorer = ElementFocusRestorer;

/** @constructor */
UI.DragHandler = DragHandler;

/** @constructor */
UI.InvokeOnceHandlers = InvokeOnceHandlers;

/** @constructor */
UI.LongClickController = LongClickController;

/** @constructor */
UI.ThemeSupport = ThemeSupport;

/** @constructor */
UI.MessageDialog = MessageDialog;

/** @constructor */
UI.ConfirmDialog = ConfirmDialog;

/** @constructor */
UI.CheckboxLabel = CheckboxLabel;

/** @interface */
UI.Renderer = Renderer;

/** @typedef {!{title: (string|!Element|undefined), editable: (boolean|undefined) }} */
UI.Renderer.Options;

UI.installDragHandle = installDragHandle;
UI.elementDragStart = elementDragStart;
UI.isBeingEdited = isBeingEdited;
UI.isEditing = isEditing;
UI.markBeingEdited = markBeingEdited;
UI._valueModificationDirection = _valueModificationDirection;
UI._modifiedHexValue = _modifiedHexValue;
UI._modifiedFloatNumber = _modifiedFloatNumber;
UI.createReplacementString = createReplacementString;
UI.handleElementValueModifications = handleElementValueModifications;
UI.formatLocalized = formatLocalized;
UI.openLinkExternallyLabel = openLinkExternallyLabel;
UI.copyLinkAddressLabel = copyLinkAddressLabel;
UI.anotherProfilerActiveLabel = anotherProfilerActiveLabel;
UI.asyncStackTraceLabel = asyncStackTraceLabel;
UI.installComponentRootStyles = installComponentRootStyles;
UI.measuredScrollbarWidth = measuredScrollbarWidth;
UI.createShadowRootWithCoreStyles = createShadowRootWithCoreStyles;
UI._injectCoreStyles = _injectCoreStyles;
UI._windowFocused = _windowFocused;
UI._windowBlurred = _windowBlurred;
UI._focusChanged = _focusChanged;
UI.highlightSearchResult = highlightSearchResult;
UI.highlightSearchResults = highlightSearchResults;
UI.runCSSAnimationOnce = runCSSAnimationOnce;
UI.highlightRangesWithStyleClass = highlightRangesWithStyleClass;
UI.applyDomChanges = applyDomChanges;
UI.revertDomChanges = revertDomChanges;
UI.measurePreferredSize = measurePreferredSize;
UI.startBatchUpdate = startBatchUpdate;
UI.endBatchUpdate = endBatchUpdate;
UI.invokeOnceAfterBatchUpdate = invokeOnceAfterBatchUpdate;
UI.animateFunction = animateFunction;
UI.initializeUIUtils = initializeUIUtils;
UI.beautifyFunctionName = beautifyFunctionName;
UI.registerCustomElement = registerCustomElement;
UI.createTextButton = createTextButton;
UI.createInput = createInput;
UI.createLabel = createLabel;
UI.createRadioLabel = createRadioLabel;
UI.createIconLabel = createIconLabel;
UI.createSlider = createSlider;
UI.appendStyle = appendStyle;
UI.bindInput = bindInput;
UI.trimText = trimText;
UI.trimTextMiddle = trimTextMiddle;
UI.trimTextEnd = trimTextEnd;
UI.measureTextWidth = measureTextWidth;
UI.createDocumentationLink = createDocumentationLink;
UI.loadImage = loadImage;
UI.loadImageFromData = loadImageFromData;
UI.createFileSelectorElement = createFileSelectorElement;
UI.createInlineButton = createInlineButton;
UI.createExpandableText = createExpandableText;
UI.formatTimestamp = formatTimestamp;

var UIUtils = /*#__PURE__*/Object.freeze({
  __proto__: null,
  highlightedSearchResultClassName: highlightedSearchResultClassName,
  highlightedCurrentSearchResultClassName: highlightedCurrentSearchResultClassName,
  installDragHandle: installDragHandle,
  elementDragStart: elementDragStart,
  DragHandler: DragHandler,
  isBeingEdited: isBeingEdited,
  isEditing: isEditing,
  markBeingEdited: markBeingEdited,
  _numberRegex: _numberRegex,
  StyleValueDelimiters: StyleValueDelimiters,
  _valueModificationDirection: _valueModificationDirection,
  _modifiedHexValue: _modifiedHexValue,
  _modifiedFloatNumber: _modifiedFloatNumber,
  createReplacementString: createReplacementString,
  handleElementValueModifications: handleElementValueModifications,
  _microsFormat: _microsFormat,
  _subMillisFormat: _subMillisFormat,
  _millisFormat: _millisFormat,
  _secondsFormat: _secondsFormat,
  _minutesFormat: _minutesFormat,
  _hoursFormat: _hoursFormat,
  _daysFormat: _daysFormat,
  formatLocalized: formatLocalized,
  openLinkExternallyLabel: openLinkExternallyLabel,
  copyLinkAddressLabel: copyLinkAddressLabel,
  anotherProfilerActiveLabel: anotherProfilerActiveLabel,
  asyncStackTraceLabel: asyncStackTraceLabel,
  installComponentRootStyles: installComponentRootStyles,
  measuredScrollbarWidth: measuredScrollbarWidth,
  createShadowRootWithCoreStyles: createShadowRootWithCoreStyles,
  _injectCoreStyles: _injectCoreStyles,
  _windowFocused: _windowFocused,
  _windowBlurred: _windowBlurred,
  _focusChanged: _focusChanged,
  ElementFocusRestorer: ElementFocusRestorer,
  highlightSearchResult: highlightSearchResult,
  highlightSearchResults: highlightSearchResults,
  runCSSAnimationOnce: runCSSAnimationOnce,
  highlightRangesWithStyleClass: highlightRangesWithStyleClass,
  applyDomChanges: applyDomChanges,
  revertDomChanges: revertDomChanges,
  measurePreferredSize: measurePreferredSize,
  InvokeOnceHandlers: InvokeOnceHandlers,
  get _coalescingLevel () { return _coalescingLevel; },
  get _postUpdateHandlers () { return _postUpdateHandlers; },
  startBatchUpdate: startBatchUpdate,
  endBatchUpdate: endBatchUpdate,
  invokeOnceAfterBatchUpdate: invokeOnceAfterBatchUpdate,
  animateFunction: animateFunction,
  LongClickController: LongClickController,
  initializeUIUtils: initializeUIUtils,
  beautifyFunctionName: beautifyFunctionName,
  registerCustomElement: registerCustomElement,
  createTextButton: createTextButton,
  createInput: createInput,
  createLabel: createLabel,
  createRadioLabel: createRadioLabel,
  createIconLabel: createIconLabel,
  createSlider: createSlider,
  appendStyle: appendStyle,
  CheckboxLabel: CheckboxLabel,
  bindInput: bindInput,
  trimText: trimText,
  trimTextMiddle: trimTextMiddle,
  trimTextEnd: trimTextEnd,
  measureTextWidth: measureTextWidth,
  ThemeSupport: ThemeSupport,
  createDocumentationLink: createDocumentationLink,
  loadImage: loadImage,
  loadImageFromData: loadImageFromData,
  createFileSelectorElement: createFileSelectorElement,
  MaxLengthForDisplayedURLs: MaxLengthForDisplayedURLs,
  MessageDialog: MessageDialog,
  ConfirmDialog: ConfirmDialog,
  createInlineButton: createInlineButton,
  createExpandableText: createExpandableText,
  Renderer: Renderer,
  formatTimestamp: formatTimestamp
});

// Copyright 2016 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @interface
 */
class View {
  /**
   * @return {string}
   */
  viewId() {
  }

  /**
   * @return {string}
   */
  title() {
  }

  /**
   * @return {boolean}
   */
  isCloseable() {
  }

  /**
   * @return {boolean}
   */
  isTransient() {
  }

  /**
   * @return {!Promise<!Array<!UI.ToolbarItem>>}
   */
  toolbarItems() {
  }

  /**
   * @return {!Promise<!UI.Widget>}
   */
  widget() {
  }

  /**
   * @return {!Promise|undefined}
   */
  disposeView() {}
}

const _symbol = Symbol('view');
const _widgetSymbol = Symbol('widget');

/**
 * @implements {View}
 * @unrestricted
 */
class SimpleView extends UI.VBox {
  /**
   * @param {string} title
   * @param {boolean=} isWebComponent
   */
  constructor(title, isWebComponent) {
    super(isWebComponent);
    this._title = title;
    /** @type {!Array<!UI.ToolbarItem>} */
    this._toolbarItems = [];
    this[_symbol] = this;
  }

  /**
   * @override
   * @return {string}
   */
  viewId() {
    return this._title;
  }

  /**
   * @override
   * @return {string}
   */
  title() {
    return this._title;
  }

  /**
   * @override
   * @return {boolean}
   */
  isCloseable() {
    return false;
  }

  /**
   * @override
   * @return {boolean}
   */
  isTransient() {
    return false;
  }

  /**
   * @override
   * @return {!Promise<!Array<!UI.ToolbarItem>>}
   */
  toolbarItems() {
    return Promise.resolve(this.syncToolbarItems());
  }

  /**
   * @return {!Array<!UI.ToolbarItem>}
   */
  syncToolbarItems() {
    return this._toolbarItems;
  }

  /**
   * @override
   * @return {!Promise<!UI.Widget>}
   */
  widget() {
    return /** @type {!Promise<!UI.Widget>} */ (Promise.resolve(this));
  }

  /**
   * @param {!UI.ToolbarItem} item
   */
  addToolbarItem(item) {
    this._toolbarItems.push(item);
  }

  /**
   * @return {!Promise}
   */
  revealView() {
    return UI.viewManager.revealView(this);
  }

  /**
   * @override
   */
  disposeView() {
  }
}

/**
 * @implements {View}
 * @unrestricted
 */
class ProvidedView {
  /**
   * @param {!Root.Runtime.Extension} extension
   */
  constructor(extension) {
    this._extension = extension;
  }

  /**
   * @override
   * @return {string}
   */
  viewId() {
    return this._extension.descriptor()['id'];
  }

  /**
   * @override
   * @return {string}
   */
  title() {
    return this._extension.title();
  }

  /**
   * @override
   * @return {boolean}
   */
  isCloseable() {
    return this._extension.descriptor()['persistence'] === 'closeable';
  }

  /**
   * @override
   * @return {boolean}
   */
  isTransient() {
    return this._extension.descriptor()['persistence'] === 'transient';
  }

  /**
   * @override
   * @return {!Promise<!Array<!UI.ToolbarItem>>}
   */
  toolbarItems() {
    const actionIds = this._extension.descriptor()['actionIds'];
    if (actionIds) {
      const result = actionIds.split(',').map(id => UI.Toolbar.createActionButtonForId(id.trim()));
      return Promise.resolve(result);
    }

    if (this._extension.descriptor()['hasToolbar']) {
      return this.widget().then(widget => /** @type {!UI.ToolbarItem.ItemsProvider} */ (widget).toolbarItems());
    }
    return Promise.resolve([]);
  }

  /**
   * @override
   * @return {!Promise<!UI.Widget>}
   */
  async widget() {
    this._widgetRequested = true;
    const widget = await this._extension.instance();
    if (!(widget instanceof UI.Widget)) {
      throw new Error('view className should point to a UI.Widget');
    }
    widget[_symbol] = this;
    return /** @type {!UI.Widget} */ (widget);
  }

  /**
   * @override
   */
  async disposeView() {
    if (!this._widgetRequested) {
      return;
    }
    const widget = await this.widget();
    widget.ownerViewDisposed();
  }
}

/**
 * @interface
 */
class ViewLocation {
  /**
   * @param {string} locationName
   */
  appendApplicableItems(locationName) {
  }

  /**
   * @param {!View} view
   * @param {?View=} insertBefore
   */
  appendView(view, insertBefore) {
  }

  /**
   * @param {!View} view
   * @param {?View=} insertBefore
   * @param {boolean=} userGesture
   * @return {!Promise}
   */
  showView(view, insertBefore, userGesture) {
  }

  /**
   * @param {!View} view
   */
  removeView(view) {
  }

  /**
   * @return {!UI.Widget}
   */
  widget() {
  }
}

/**
 * @interface
 */
class TabbedViewLocation extends ViewLocation {
  /**
   * @return {!UI.TabbedPane}
   */
  tabbedPane() {
  }

  /**
   * @return {!UI.ToolbarMenuButton}
   */
  enableMoreTabsButton() {
  }
}

/**
 * @interface
 */
class ViewLocationResolver {
  /**
   * @param {string} location
   * @return {?ViewLocation}
   */
  resolveLocation(location) {
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @interface */
UI.View = View;

/** @public */
UI.View.widgetSymbol = _widgetSymbol;

/** @constructor */
UI.SimpleView = SimpleView;

/** @constructor */
UI.ProvidedView = ProvidedView;

/** @interface */
UI.ViewLocation = ViewLocation;

/** @interface */
UI.TabbedViewLocation = TabbedViewLocation;

/** @interface */
UI.ViewLocationResolver = ViewLocationResolver;

var View$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': View,
  _symbol: _symbol,
  _widgetSymbol: _widgetSymbol,
  SimpleView: SimpleView,
  ProvidedView: ProvidedView,
  ViewLocation: ViewLocation,
  TabbedViewLocation: TabbedViewLocation,
  ViewLocationResolver: ViewLocationResolver
});

// Copyright 2019 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @unrestricted
 */
class ViewManager {
  constructor() {
    /** @type {!Map<string, !UI.View>} */
    this._views = new Map();
    /** @type {!Map<string, string>} */
    this._locationNameByViewId = new Map();

    for (const extension of self.runtime.extensions('view')) {
      const descriptor = extension.descriptor();
      this._views.set(descriptor['id'], new UI.ProvidedView(extension));
      this._locationNameByViewId.set(descriptor['id'], descriptor['location']);
    }
  }

  /**
   * @param {!Element} element
   * @param {!Array<!UI.ToolbarItem>} toolbarItems
   */
  static _populateToolbar(element, toolbarItems) {
    if (!toolbarItems.length) {
      return;
    }
    const toolbar = new UI.Toolbar('');
    element.insertBefore(toolbar.element, element.firstChild);
    for (const item of toolbarItems) {
      toolbar.appendToolbarItem(item);
    }
  }

  /**
   * @param {!UI.View} view
   * @return {!Promise}
   */
  revealView(view) {
    const location = /** @type {?_Location} */ (view[_Location.symbol]);
    if (!location) {
      return Promise.resolve();
    }
    location._reveal();
    return location.showView(view);
  }

  /**
   * @param {string} viewId
   * @return {?UI.View}
   */
  view(viewId) {
    return this._views.get(viewId);
  }

  /**
   * @param {string} viewId
   * @return {?UI.Widget}
   */
  materializedWidget(viewId) {
    const view = this.view(viewId);
    return view ? view[UI.View.widgetSymbol] : null;
  }

  /**
   * @param {string} viewId
   * @param {boolean=} userGesture
   * @param {boolean=} omitFocus
   * @return {!Promise}
   */
  showView(viewId, userGesture, omitFocus) {
    const view = this._views.get(viewId);
    if (!view) {
      console.error('Could not find view for id: \'' + viewId + '\' ' + new Error().stack);
      return Promise.resolve();
    }

    const locationName = this._locationNameByViewId.get(viewId);

    const location = view[_Location.symbol];
    if (location) {
      location._reveal();
      return location.showView(view, undefined, userGesture, omitFocus);
    }

    return this.resolveLocation(locationName).then(location => {
      if (!location) {
        throw new Error('Could not resolve location for view: ' + viewId);
      }
      location._reveal();
      return location.showView(view, undefined, userGesture, omitFocus);
    });
  }

  /**
   * @param {string=} location
   * @return {!Promise<?_Location>}
   */
  resolveLocation(location) {
    if (!location) {
      return /** @type {!Promise<?_Location>} */ (Promise.resolve(null));
    }

    const resolverExtensions = self.runtime.extensions(UI.ViewLocationResolver)
                                   .filter(extension => extension.descriptor()['name'] === location);
    if (!resolverExtensions.length) {
      throw new Error('Unresolved location: ' + location);
    }
    const resolverExtension = resolverExtensions[0];
    return resolverExtension.instance().then(
        resolver => /** @type {?_Location} */ (resolver.resolveLocation(location)));
  }

  /**
   * @param {function()=} revealCallback
   * @param {string=} location
   * @param {boolean=} restoreSelection
   * @param {boolean=} allowReorder
   * @param {?string=} defaultTab
   * @return {!UI.TabbedViewLocation}
   */
  createTabbedLocation(revealCallback, location, restoreSelection, allowReorder, defaultTab) {
    return new UI.ViewManager._TabbedLocation(
        this, revealCallback, location, restoreSelection, allowReorder, defaultTab);
  }

  /**
   * @param {function()=} revealCallback
   * @param {string=} location
   * @return {!UI.ViewLocation}
   */
  createStackLocation(revealCallback, location) {
    return new _StackLocation(this, revealCallback, location);
  }

  /**
   * @param {string} location
   * @return {boolean}
   */
  hasViewsForLocation(location) {
    return !!this._viewsForLocation(location).length;
  }

  /**
   * @param {string} location
   * @return {!Array<!UI.View>}
   */
  _viewsForLocation(location) {
    const result = [];
    for (const id of this._views.keys()) {
      if (this._locationNameByViewId.get(id) === location) {
        result.push(this._views.get(id));
      }
    }
    return result;
  }
}


/**
 * @unrestricted
 */
class _ContainerWidget extends UI.VBox {
  /**
   * @param {!UI.View} view
   */
  constructor(view) {
    super();
    this.element.classList.add('flex-auto', 'view-container', 'overflow-auto');
    this._view = view;
    this.element.tabIndex = -1;
    this.setDefaultFocusedElement(this.element);
  }

  /**
   * @return {!Promise}
   */
  _materialize() {
    if (this._materializePromise) {
      return this._materializePromise;
    }
    const promises = [];
    // TODO(crbug.com/1006759): Transform to async-await
    promises.push(this._view.toolbarItems().then(UI.ViewManager._populateToolbar.bind(UI.ViewManager, this.element)));
    promises.push(this._view.widget().then(widget => {
      // Move focus from |this| to loaded |widget| if any.
      const shouldFocus = this.element.hasFocus();
      this.setDefaultFocusedElement(null);
      this._view[UI.View.widgetSymbol] = widget;
      widget.show(this.element);
      if (shouldFocus) {
        widget.focus();
      }
    }));
    this._materializePromise = Promise.all(promises);
    return this._materializePromise;
  }

  /**
   * @override
   */
  wasShown() {
    this._materialize().then(() => {
      this._wasShownForTest();
    });
  }

  _wasShownForTest() {
    // This method is sniffed in tests.
  }
}

/**
 * @unrestricted
 */
class _ExpandableContainerWidget extends UI.VBox {
  /**
   * @param {!UI.View} view
   */
  constructor(view) {
    super(true);
    this.element.classList.add('flex-none');
    this.registerRequiredCSS('ui/viewContainers.css');

    this._titleElement = createElementWithClass('div', 'expandable-view-title');
    UI.ARIAUtils.markAsLink(this._titleElement);
    this._titleExpandIcon = UI.Icon.create('smallicon-triangle-right', 'title-expand-icon');
    this._titleElement.appendChild(this._titleExpandIcon);
    const titleText = view.title();
    this._titleElement.createTextChild(titleText);
    UI.ARIAUtils.setAccessibleName(this._titleElement, titleText);
    this._titleElement.tabIndex = 0;
    this._titleElement.addEventListener('click', this._toggleExpanded.bind(this), false);
    this._titleElement.addEventListener('keydown', this._onTitleKeyDown.bind(this), false);
    this.contentElement.insertBefore(this._titleElement, this.contentElement.firstChild);

    this.contentElement.createChild('slot');
    this._view = view;
    view[UI.ViewManager._ExpandableContainerWidget._symbol] = this;
  }

  /**
   * @return {!Promise}
   */
  _materialize() {
    if (this._materializePromise) {
      return this._materializePromise;
    }
    // TODO(crbug.com/1006759): Transform to async-await
    const promises = [];
    promises.push(
        this._view.toolbarItems().then(UI.ViewManager._populateToolbar.bind(UI.ViewManager, this._titleElement)));
    promises.push(this._view.widget().then(widget => {
      this._widget = widget;
      this._view[UI.View.widgetSymbol] = widget;
      widget.show(this.element);
    }));
    this._materializePromise = Promise.all(promises);
    return this._materializePromise;
  }

  /**
   * @return {!Promise}
   */
  _expand() {
    if (this._titleElement.classList.contains('expanded')) {
      return this._materialize();
    }
    this._titleElement.classList.add('expanded');
    UI.ARIAUtils.setExpanded(this._titleElement, true);
    this._titleExpandIcon.setIconType('smallicon-triangle-down');
    return this._materialize().then(() => this._widget.show(this.element));
  }

  _collapse() {
    if (!this._titleElement.classList.contains('expanded')) {
      return;
    }
    this._titleElement.classList.remove('expanded');
    UI.ARIAUtils.setExpanded(this._titleElement, false);
    this._titleExpandIcon.setIconType('smallicon-triangle-right');
    this._materialize().then(() => this._widget.detach());
  }

  _toggleExpanded() {
    if (this._titleElement.classList.contains('expanded')) {
      this._collapse();
    } else {
      this._expand();
    }
  }

  /**
   * @param {!Event} event
   */
  _onTitleKeyDown(event) {
    if (isEnterOrSpaceKey(event)) {
      this._toggleExpanded();
    } else if (event.key === 'ArrowLeft') {
      this._collapse();
    } else if (event.key === 'ArrowRight') {
      if (!this._titleElement.classList.contains('expanded')) {
        this._expand();
      } else if (this._widget) {
        this._widget.focus();
      }
    }
  }
}

_ExpandableContainerWidget._symbol = Symbol('container');

/**
 * @unrestricted
 */
class _Location {
  /**
   * @param {!UI.ViewManager} manager
   * @param {!UI.Widget} widget
   * @param {function()=} revealCallback
   */
  constructor(manager, widget, revealCallback) {
    this._manager = manager;
    this._revealCallback = revealCallback;
    this._widget = widget;
  }

  /**
   * @return {!UI.Widget}
   */
  widget() {
    return this._widget;
  }

  _reveal() {
    if (this._revealCallback) {
      this._revealCallback();
    }
  }
}

_Location.symbol = Symbol('location');

/**
 * @implements {UI.TabbedViewLocation}
 * @unrestricted
 */
class _TabbedLocation extends _Location {
  /**
   * @param {!UI.ViewManager} manager
   * @param {function()=} revealCallback
   * @param {string=} location
   * @param {boolean=} restoreSelection
   * @param {boolean=} allowReorder
   * @param {?string=} defaultTab
   */
  constructor(manager, revealCallback, location, restoreSelection, allowReorder, defaultTab) {
    const tabbedPane = new UI.TabbedPane();
    if (allowReorder) {
      tabbedPane.setAllowTabReorder(true);
    }

    super(manager, tabbedPane, revealCallback);
    this._tabbedPane = tabbedPane;
    this._allowReorder = allowReorder;

    this._tabbedPane.addEventListener(UI.TabbedPane.Events.TabSelected, this._tabSelected, this);
    this._tabbedPane.addEventListener(UI.TabbedPane.Events.TabClosed, this._tabClosed, this);
    this._closeableTabSetting = Common.settings.createSetting(location + '-closeableTabs', {});
    this._tabOrderSetting = Common.settings.createSetting(location + '-tabOrder', {});
    this._tabbedPane.addEventListener(UI.TabbedPane.Events.TabOrderChanged, this._persistTabOrder, this);
    if (restoreSelection) {
      this._lastSelectedTabSetting = Common.settings.createSetting(location + '-selectedTab', '');
    }
    this._defaultTab = defaultTab;

    /** @type {!Map.<string, !UI.View>} */
    this._views = new Map();

    if (location) {
      this.appendApplicableItems(location);
    }
  }

  /**
   * @override
   * @return {!UI.Widget}
   */
  widget() {
    return this._tabbedPane;
  }

  /**
   * @override
   * @return {!UI.TabbedPane}
   */
  tabbedPane() {
    return this._tabbedPane;
  }

  /**
   * @override
   * @return {!UI.ToolbarMenuButton}
   */
  enableMoreTabsButton() {
    const moreTabsButton = new UI.ToolbarMenuButton(this._appendTabsToMenu.bind(this));
    this._tabbedPane.leftToolbar().appendToolbarItem(moreTabsButton);
    this._tabbedPane.disableOverflowMenu();
    return moreTabsButton;
  }

  /**
   * @override
   * @param {string} locationName
   */
  appendApplicableItems(locationName) {
    const views = this._manager._viewsForLocation(locationName);
    if (this._allowReorder) {
      let i = 0;
      const persistedOrders = this._tabOrderSetting.get();
      const orders = new Map();
      for (const view of views) {
        orders.set(view.viewId(), persistedOrders[view.viewId()] || (++i) * UI.ViewManager._TabbedLocation.orderStep);
      }
      views.sort((a, b) => orders.get(a.viewId()) - orders.get(b.viewId()));
    }

    for (const view of views) {
      const id = view.viewId();
      this._views.set(id, view);
      view[_Location.symbol] = this;
      if (view.isTransient()) {
        continue;
      }
      if (!view.isCloseable()) {
        this._appendTab(view);
      } else if (this._closeableTabSetting.get()[id]) {
        this._appendTab(view);
      }
    }
    if (this._defaultTab && this._tabbedPane.hasTab(this._defaultTab)) {
      this._tabbedPane.selectTab(this._defaultTab);
    } else if (this._lastSelectedTabSetting && this._tabbedPane.hasTab(this._lastSelectedTabSetting.get())) {
      this._tabbedPane.selectTab(this._lastSelectedTabSetting.get());
    }
  }

  /**
   * @param {!UI.ContextMenu} contextMenu
   */
  _appendTabsToMenu(contextMenu) {
    const views = Array.from(this._views.values());
    views.sort((viewa, viewb) => viewa.title().localeCompare(viewb.title()));
    for (const view of views) {
      const title = Common.UIString(view.title());
      contextMenu.defaultSection().appendItem(title, this.showView.bind(this, view, undefined, true));
    }
  }

  /**
   * @param {!UI.View} view
   * @param {number=} index
   */
  _appendTab(view, index) {
    this._tabbedPane.appendTab(
        view.viewId(), view.title(), new UI.ViewManager._ContainerWidget(view), undefined, false,
        view.isCloseable() || view.isTransient(), index);
  }

  /**
   * @override
   * @param {!UI.View} view
   * @param {?UI.View=} insertBefore
   */
  appendView(view, insertBefore) {
    if (this._tabbedPane.hasTab(view.viewId())) {
      return;
    }
    const oldLocation = view[_Location.symbol];
    if (oldLocation && oldLocation !== this) {
      oldLocation.removeView(view);
    }
    view[_Location.symbol] = this;
    this._manager._views.set(view.viewId(), view);
    this._views.set(view.viewId(), view);
    let index = undefined;
    const tabIds = this._tabbedPane.tabIds();
    if (this._allowReorder) {
      const orderSetting = this._tabOrderSetting.get();
      const order = orderSetting[view.viewId()];
      for (let i = 0; order && i < tabIds.length; ++i) {
        if (orderSetting[tabIds[i]] && orderSetting[tabIds[i]] > order) {
          index = i;
          break;
        }
      }
    } else if (insertBefore) {
      for (let i = 0; i < tabIds.length; ++i) {
        if (tabIds[i] === insertBefore.viewId()) {
          index = i;
          break;
        }
      }
    }
    this._appendTab(view, index);

    if (view.isCloseable()) {
      const tabs = this._closeableTabSetting.get();
      const tabId = view.viewId();
      if (!tabs[tabId]) {
        tabs[tabId] = true;
        this._closeableTabSetting.set(tabs);
      }
    }
    this._persistTabOrder();
  }

  /**
   * @override
   * @param {!UI.View} view
   * @param {?UI.View=} insertBefore
   * @param {boolean=} userGesture
   * @param {boolean=} omitFocus
   * @return {!Promise}
   */
  showView(view, insertBefore, userGesture, omitFocus) {
    this.appendView(view, insertBefore);
    this._tabbedPane.selectTab(view.viewId(), userGesture);
    if (!omitFocus) {
      this._tabbedPane.focus();
    }
    const widget = /** @type {!UI.ViewManager._ContainerWidget} */ (this._tabbedPane.tabView(view.viewId()));
    return widget._materialize();
  }

  /**
   * @param {!UI.View} view
   * @override
   */
  removeView(view) {
    if (!this._tabbedPane.hasTab(view.viewId())) {
      return;
    }

    delete view[_Location.symbol];
    this._manager._views.delete(view.viewId());
    this._tabbedPane.closeTab(view.viewId());
    this._views.delete(view.viewId());
  }

  /**
   * @param {!Common.Event} event
   */
  _tabSelected(event) {
    const tabId = /** @type {string} */ (event.data.tabId);
    if (this._lastSelectedTabSetting && event.data['isUserGesture']) {
      this._lastSelectedTabSetting.set(tabId);
    }
  }

  /**
   * @param {!Common.Event} event
   */
  _tabClosed(event) {
    const id = /** @type {string} */ (event.data['tabId']);
    const tabs = this._closeableTabSetting.get();
    if (tabs[id]) {
      delete tabs[id];
      this._closeableTabSetting.set(tabs);
    }
    this._views.get(id).disposeView();
  }

  _persistTabOrder() {
    const tabIds = this._tabbedPane.tabIds();
    const tabOrders = {};
    for (let i = 0; i < tabIds.length; i++) {
      tabOrders[tabIds[i]] = (i + 1) * UI.ViewManager._TabbedLocation.orderStep;
    }

    const oldTabOrder = this._tabOrderSetting.get();
    const oldTabArray = Object.keys(oldTabOrder);
    oldTabArray.sort((a, b) => oldTabOrder[a] - oldTabOrder[b]);
    let lastOrder = 0;
    for (const key of oldTabArray) {
      if (key in tabOrders) {
        lastOrder = tabOrders[key];
        continue;
      }
      tabOrders[key] = ++lastOrder;
    }
    this._tabOrderSetting.set(tabOrders);
  }
}

_TabbedLocation.orderStep = 10;  // Keep in sync with descriptors.

/**
 * @implements {UI.ViewLocation}
 * @unrestricted
 */
class _StackLocation extends _Location {
  /**
   * @param {!UI.ViewManager} manager
   * @param {function()=} revealCallback
   * @param {string=} location
   */
  constructor(manager, revealCallback, location) {
    const vbox = new UI.VBox();
    super(manager, vbox, revealCallback);
    this._vbox = vbox;

    /** @type {!Map<string, !UI.ViewManager._ExpandableContainerWidget>} */
    this._expandableContainers = new Map();

    if (location) {
      this.appendApplicableItems(location);
    }
  }

  /**
   * @override
   * @param {!UI.View} view
   * @param {?UI.View=} insertBefore
   */
  appendView(view, insertBefore) {
    const oldLocation = view[_Location.symbol];
    if (oldLocation && oldLocation !== this) {
      oldLocation.removeView(view);
    }

    let container = this._expandableContainers.get(view.viewId());
    if (!container) {
      view[_Location.symbol] = this;
      this._manager._views.set(view.viewId(), view);
      container = new UI.ViewManager._ExpandableContainerWidget(view);
      let beforeElement = null;
      if (insertBefore) {
        const beforeContainer = insertBefore[UI.ViewManager._ExpandableContainerWidget._symbol];
        beforeElement = beforeContainer ? beforeContainer.element : null;
      }
      container.show(this._vbox.contentElement, beforeElement);
      this._expandableContainers.set(view.viewId(), container);
    }
  }

  /**
   * @override
   * @param {!UI.View} view
   * @param {?UI.View=} insertBefore
   * @return {!Promise}
   */
  showView(view, insertBefore) {
    this.appendView(view, insertBefore);
    const container = this._expandableContainers.get(view.viewId());
    return container._expand();
  }

  /**
   * @param {!UI.View} view
   * @override
   */
  removeView(view) {
    const container = this._expandableContainers.get(view.viewId());
    if (!container) {
      return;
    }

    container.detach();
    this._expandableContainers.delete(view.viewId());
    delete view[_Location.symbol];
    this._manager._views.delete(view.viewId());
  }

  /**
   * @override
   * @param {string} locationName
   */
  appendApplicableItems(locationName) {
    for (const view of this._manager._viewsForLocation(locationName)) {
      this.appendView(view);
    }
  }
}

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/**
 * @type {!UI.ViewManager}
 */
UI.viewManager;

/** @constructor */
UI.ViewManager = ViewManager;

/** @constructor */
UI.ViewManager._ContainerWidget = _ContainerWidget;

/** @constructor */
UI.ViewManager._ExpandableContainerWidget = _ExpandableContainerWidget;

/** @constructor */
UI.ViewManager._Location = _Location;

/** @constructor */
UI.ViewManager._TabbedLocation = _TabbedLocation;

/** @constructor */
UI.ViewManager._StackLocation = _StackLocation;

var ViewManager$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ViewManager,
  _ContainerWidget: _ContainerWidget,
  _ExpandableContainerWidget: _ExpandableContainerWidget,
  _Location: _Location,
  _TabbedLocation: _TabbedLocation,
  _StackLocation: _StackLocation
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class XElement extends HTMLElement {
  /**
   * @override
   */
  static get observedAttributes() {
    return [
      'flex',          'padding',     'padding-top',      'padding-bottom', 'padding-left',
      'padding-right', 'margin',      'margin-top',       'margin-bottom',  'margin-left',
      'margin-right',  'overflow',    'overflow-x',       'overflow-y',     'font-size',
      'color',         'background',  'background-color', 'border',         'border-top',
      'border-bottom', 'border-left', 'border-right',     'max-width',      'max-height'
    ];
  }

  /**
   * @param {string} attr
   * @param {?string} oldValue
   * @param {?string} newValue
   * @override
   */
  attributeChangedCallback(attr, oldValue, newValue) {
    if (attr === 'flex') {
      if (newValue === null) {
        this.style.removeProperty('flex');
      } else if (newValue === 'initial' || newValue === 'auto' || newValue === 'none' || newValue.indexOf(' ') !== -1) {
        this.style.setProperty('flex', newValue);
      } else {
        this.style.setProperty('flex', '0 0 ' + newValue);
      }
      return;
    }
    if (newValue === null) {
      this.style.removeProperty(attr);
      if (attr.startsWith('padding-') || attr.startsWith('margin-') || attr.startsWith('border-') ||
          attr.startsWith('background-') || attr.startsWith('overflow-')) {
        const shorthand = attr.substring(0, attr.indexOf('-'));
        const shorthandValue = this.getAttribute(shorthand);
        if (shorthandValue !== null) {
          this.style.setProperty(shorthand, shorthandValue);
        }
      }
    } else {
      this.style.setProperty(attr, newValue);
    }
  }
}

/**
 * @extends {XElement}
 */
class _XBox extends XElement {
  /**
   * @param {string} direction
   */
  constructor(direction) {
    super();
    this.style.setProperty('display', 'flex');
    this.style.setProperty('flex-direction', direction);
    this.style.setProperty('justify-content', 'flex-start');
  }

  /**
   * @override
   */
  static get observedAttributes() {
    return super.observedAttributes.concat(['x-start', 'x-center', 'x-stretch', 'x-baseline', 'justify-content']);
  }

  /**
   * @param {string} attr
   * @param {?string} oldValue
   * @param {?string} newValue
   * @override
   */
  attributeChangedCallback(attr, oldValue, newValue) {
    if (attr === 'x-start' || attr === 'x-center' || attr === 'x-stretch' || attr === 'x-baseline') {
      if (newValue === null) {
        this.style.removeProperty('align-items');
      } else {
        this.style.setProperty('align-items', attr === 'x-start' ? 'flex-start' : attr.substr(2));
      }
      return;
    }
    super.attributeChangedCallback(attr, oldValue, newValue);
  }
}

/**
 * @extends {_XBox}
 */
class XVBox extends _XBox {
  constructor() {
    super('column');
  }
}

/**
 * @extends {_XBox}
 */
class XHBox extends _XBox {
  constructor() {
    super('row');
  }
}

/**
 * @extends {XElement}
 */
class XCBox extends XElement {
  constructor() {
    super();
    this.style.setProperty('display', 'flex');
    this.style.setProperty('flex-direction', 'column');
    this.style.setProperty('justify-content', 'center');
    this.style.setProperty('align-items', 'center');
  }
}

/**
 * @extends {XElement}
 */
class XDiv extends XElement {
  constructor() {
    super();
    this.style.setProperty('display', 'block');
  }
}

/**
 * @extends {XElement}
 */
class XSpan extends XElement {
  constructor() {
    super();
    this.style.setProperty('display', 'inline');
  }
}

/**
 * @extends {XElement}
 */
class XText extends XElement {
  constructor() {
    super();
    this.style.setProperty('display', 'inline');
    this.style.setProperty('white-space', 'pre');
  }
}

self.customElements.define('x-vbox', XVBox);
self.customElements.define('x-hbox', XHBox);
self.customElements.define('x-cbox', XCBox);
self.customElements.define('x-div', XDiv);
self.customElements.define('x-span', XSpan);
self.customElements.define('x-text', XText);

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.XElement = XElement;

/** @constructor */
UI._XBox = _XBox;

/** @constructor */
UI.XVBox = XVBox;

/** @constructor */
UI.XHBox = XHBox;

/** @constructor */
UI.XCBox = XCBox;

/** @constructor */
UI.XDiv = XDiv;

/** @constructor */
UI.XSpan = XSpan;

/** @constructor */
UI.XText = XText;

var XElement$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': XElement,
  _XBox: _XBox,
  XVBox: XVBox,
  XHBox: XHBox,
  XCBox: XCBox,
  XDiv: XDiv,
  XSpan: XSpan,
  XText: XText
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @extends {UI.XElement}
 */
class XLink extends UI.XElement {
  /**
   * @param {string} url
   * @param {string=} linkText
   * @param {string=} className
   * @param {boolean=} preventClick
   * @return {!Element}
   */
  static create(url, linkText, className, preventClick) {
    if (!linkText) {
      linkText = url;
    }
    className = className || '';
    // clang-format off
    // TODO(dgozman): migrate css from 'devtools-link' to 'x-link'.
    return UI.html`
        <x-link href='${url}' class='${className} devtools-link' ${preventClick ? 'no-click' : ''}
        >${linkText.trimMiddle(UI.MaxLengthForDisplayedURLs)}</x-link>`;
    // clang-format on
  }

  constructor() {
    super();

    this.style.setProperty('display', 'inline');
    UI.ARIAUtils.markAsLink(this);
    this.tabIndex = 0;
    this.setAttribute('target', '_blank');

    /** @type {?string} */
    this._href = null;
    this._clickable = true;

    this._onClick = event => {
      event.consume(true);
      Host.InspectorFrontendHost.openInNewTab(/** @type {string} */ (this._href));
    };
    this._onKeyDown = event => {
      if (isEnterOrSpaceKey(event)) {
        event.consume(true);
        Host.InspectorFrontendHost.openInNewTab(/** @type {string} */ (this._href));
      }
    };
  }

  /**
   * @override
   * @return {!Array<string>}
   */
  static get observedAttributes() {
    // TODO(dgozman): should be super.observedAttributes, but it does not compile.
    return UI.XElement.observedAttributes.concat(['href', 'no-click']);
  }

  /**
   * @param {string} attr
   * @param {?string} oldValue
   * @param {?string} newValue
   * @override
   */
  attributeChangedCallback(attr, oldValue, newValue) {
    if (attr === 'no-click') {
      this._clickable = !newValue;
      this._updateClick();
      return;
    }

    if (attr === 'href') {
      let href = newValue;
      if (newValue.trim().toLowerCase().startsWith('javascript:')) {
        href = null;
      }
      if (Common.ParsedURL.isRelativeURL(newValue)) {
        href = null;
      }

      this._href = href;
      this.title = newValue;
      this._updateClick();
      return;
    }

    super.attributeChangedCallback(attr, oldValue, newValue);
  }

  _updateClick() {
    if (this._href !== null && this._clickable) {
      this.addEventListener('click', this._onClick, false);
      this.addEventListener('keydown', this._onKeyDown, false);
      this.style.setProperty('cursor', 'pointer');
    } else {
      this.removeEventListener('click', this._onClick, false);
      this.removeEventListener('keydown', this._onKeyDown, false);
      this.style.removeProperty('cursor');
    }
  }
}

/**
 * @implements {UI.ContextMenu.Provider}
 */
class ContextMenuProvider {
  /**
   * @override
   * @param {!Event} event
   * @param {!UI.ContextMenu} contextMenu
   * @param {!Object} target
   */
  appendApplicableItems(event, contextMenu, target) {
    let targetNode = /** @type {!Node} */ (target);
    while (targetNode && !(targetNode instanceof XLink)) {
      targetNode = targetNode.parentNodeOrShadowHost();
    }
    if (!targetNode || !targetNode._href) {
      return;
    }
    contextMenu.revealSection().appendItem(
        UI.openLinkExternallyLabel(), () => Host.InspectorFrontendHost.openInNewTab(targetNode._href));
    contextMenu.revealSection().appendItem(
        UI.copyLinkAddressLabel(), () => Host.InspectorFrontendHost.copyText(targetNode._href));
  }
}

self.customElements.define('x-link', XLink);

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.XLink = XLink;

/**
 * @implements {UI.ContextMenu.Provider}
 */
UI.XLink.ContextMenuProvider = ContextMenuProvider;

var XLink$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': XLink,
  ContextMenuProvider: ContextMenuProvider
});

// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @extends {UI.XElement}
 */
class XWidget extends UI.XElement {
  constructor() {
    super();
    this.style.setProperty('display', 'flex');
    this.style.setProperty('flex-direction', 'column');
    this.style.setProperty('align-items', 'stretch');
    this.style.setProperty('justify-content', 'flex-start');
    this.style.setProperty('contain', 'layout style');

    this._visible = false;
    /** @type {?DocumentFragment} */
    this._shadowRoot;
    /** @type {?Element} */
    this._defaultFocusedElement = null;
    /** @type {!Array<!Element>} */
    this._elementsToRestoreScrollPositionsFor = [];
    /** @type {?function()} */
    this._onShownCallback;
    /** @type {?function()} */
    this._onHiddenCallback;
    /** @type {?function()} */
    this._onResizedCallback;

    if (!XWidget._observer) {
      XWidget._observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.target._visible && entry.target._onResizedCallback) {
            entry.target._onResizedCallback.call(null);
          }
        }
      });
    }
    XWidget._observer.observe(this);

    this.setElementsToRestoreScrollPositionsFor([this]);
  }

  /**
   * @param {?Node} node
   */
  static focusWidgetForNode(node) {
    node = node && node.parentNodeOrShadowHost();
    let widget = null;
    while (node) {
      if (node instanceof XWidget) {
        if (widget) {
          node._defaultFocusedElement = widget;
        }
        widget = node;
      }
      node = node.parentNodeOrShadowHost();
    }
  }

  /**
   * @return {boolean}
   */
  isShowing() {
    return this._visible;
  }

  /**
   * @param {string} cssFile
   */
  registerRequiredCSS(cssFile) {
    UI.appendStyle(this._shadowRoot || this, cssFile);
  }

  /**
   * @param {?function()} callback
   */
  setOnShown(callback) {
    this._onShownCallback = callback;
  }

  /**
   * @param {?function()} callback
   */
  setOnHidden(callback) {
    this._onHiddenCallback = callback;
  }

  /**
   * @param {?function()} callback
   */
  setOnResized(callback) {
    this._onResizedCallback = callback;
  }

  /**
   * @param {!Array<!Element>} elements
   */
  setElementsToRestoreScrollPositionsFor(elements) {
    for (const element of this._elementsToRestoreScrollPositionsFor) {
      element.removeEventListener('scroll', XWidget._storeScrollPosition, {passive: true, capture: false});
    }
    this._elementsToRestoreScrollPositionsFor = elements;
    for (const element of this._elementsToRestoreScrollPositionsFor) {
      element.addEventListener('scroll', XWidget._storeScrollPosition, {passive: true, capture: false});
    }
  }

  restoreScrollPositions() {
    for (const element of this._elementsToRestoreScrollPositionsFor) {
      if (element._scrollTop) {
        element.scrollTop = element._scrollTop;
      }
      if (element._scrollLeft) {
        element.scrollLeft = element._scrollLeft;
      }
    }
  }

  /**
   * @param {!Event} event
   */
  static _storeScrollPosition(event) {
    const element = event.currentTarget;
    element._scrollTop = element.scrollTop;
    element._scrollLeft = element.scrollLeft;
  }

  /**
   * @param {?Element} element
   */
  setDefaultFocusedElement(element) {
    if (element && !this.isSelfOrAncestor(element)) {
      throw new Error('Default focus must be descendant');
    }
    this._defaultFocusedElement = element;
  }

  /**
   * @override
   */
  focus() {
    if (!this._visible) {
      return;
    }

    let element;
    if (this._defaultFocusedElement && this.isSelfOrAncestor(this._defaultFocusedElement)) {
      element = this._defaultFocusedElement;
    } else if (this.tabIndex !== -1) {
      element = this;
    } else {
      let child = this.traverseNextNode(this);
      while (child) {
        if ((child instanceof XWidget) && child._visible) {
          element = child;
          break;
        }
        child = child.traverseNextNode(this);
      }
    }

    if (!element || element.hasFocus()) {
      return;
    }
    if (element === this) {
      HTMLElement.prototype.focus.call(this);
    } else {
      element.focus();
    }
  }

  /**
   * @override
   */
  connectedCallback() {
    this._visible = true;
    this.restoreScrollPositions();
    if (this._onShownCallback) {
      this._onShownCallback.call(null);
    }
  }

  /**
   * @override
   */
  disconnectedCallback() {
    this._visible = false;
    if (this._onHiddenCallback) {
      this._onHiddenCallback.call(null);
    }
  }
}

self.customElements.define('x-widget', XWidget);

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.XWidget = XWidget;

var XWidget$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': XWidget
});

// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/**
 * @unrestricted
 */
class ZoomManager extends Common.Object {
  /**
   * @param {!Window} window
   * @param {!InspectorFrontendHostAPI} frontendHost
   */
  constructor(window, frontendHost) {
    super();
    this._frontendHost = frontendHost;
    this._zoomFactor = this._frontendHost.zoomFactor();
    window.addEventListener('resize', this._onWindowResize.bind(this), true);
  }

  /**
   * @return {number}
   */
  zoomFactor() {
    return this._zoomFactor;
  }

  /**
   * @param {number} value
   * @return {number}
   */
  cssToDIP(value) {
    return value * this._zoomFactor;
  }

  /**
   * @param {number} valueDIP
   * @return {number}
   */
  dipToCSS(valueDIP) {
    return valueDIP / this._zoomFactor;
  }

  _onWindowResize() {
    const oldZoomFactor = this._zoomFactor;
    this._zoomFactor = this._frontendHost.zoomFactor();
    if (oldZoomFactor !== this._zoomFactor) {
      this.dispatchEventToListeners(Events.ZoomChanged, {from: oldZoomFactor, to: this._zoomFactor});
    }
  }
}

/** @enum {symbol} */
const Events = {
  ZoomChanged: Symbol('ZoomChanged')
};

/* Legacy exported object*/
self.UI = self.UI || {};

/* Legacy exported object*/
UI = UI || {};

/** @constructor */
UI.ZoomManager = ZoomManager;

/** @enum {symbol} */
UI.ZoomManager.Events = Events;

/**
 * @type {!UI.ZoomManager}
 */
UI.zoomManager;

var ZoomManager$1 = /*#__PURE__*/Object.freeze({
  __proto__: null,
  'default': ZoomManager,
  Events: Events
});

export { ARIAUtils, Action$1 as Action, ActionDelegate$2 as ActionDelegate, ActionRegistry$1 as ActionRegistry, Context$1 as Context, ContextFlavorListener$1 as ContextFlavorListener, ContextMenu$1 as ContextMenu, Dialog$1 as Dialog, DropTarget$1 as DropTarget, EmptyWidget$1 as EmptyWidget, FilterBar$1 as FilterBar, FilterSuggestionBuilder$1 as FilterSuggestionBuilder, ForwardedInputEventHandler$1 as ForwardedInputEventHandler, Fragment$1 as Fragment, Geometry$1 as Geometry, GlassPane$1 as GlassPane, HistoryInput$1 as HistoryInput, Icon$1 as Icon, Infobar$1 as Infobar, InplaceEditor$1 as InplaceEditor, InspectorView$1 as InspectorView, KeyboardShortcut$1 as KeyboardShortcut, ListControl$1 as ListControl, ListModel$1 as ListModel, ListWidget$1 as ListWidget, Panel$1 as Panel, PopoverHelper$1 as PopoverHelper, ProgressIndicator$1 as ProgressIndicator, RemoteDebuggingTerminatedScreen$1 as RemoteDebuggingTerminatedScreen, ReportView$1 as ReportView, ResizerWidget$1 as ResizerWidget, RootView$1 as RootView, SearchableView$1 as SearchableView, SegmentedButton$1 as SegmentedButton, SettingsUI$1 as SettingsUI, ShortcutRegistry$1 as ShortcutRegistry, ShortcutsScreen$1 as ShortcutsScreen, SoftContextMenu$1 as SoftContextMenu, SoftDropDown$1 as SoftDropDown, SplitWidget$1 as SplitWidget, SuggestBox$1 as SuggestBox, SyntaxHighlighter$1 as SyntaxHighlighter, TabbedPane$1 as TabbedPane, TargetCrashedScreen$1 as TargetCrashedScreen, TextEditor$1 as TextEditor, TextPrompt$1 as TextPrompt, ThrottledWidget$1 as ThrottledWidget, Toolbar$1 as Toolbar, Tooltip$1 as Tooltip, Treeoutline, UIUtils, View$1 as View, ViewManager$1 as ViewManager, Widget$1 as Widget, XElement$1 as XElement, XLink$1 as XLink, XWidget$1 as XWidget, ZoomManager$1 as ZoomManager };
