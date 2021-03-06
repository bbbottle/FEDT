export const sideNavStyle = `
/*
 * Copyright (c) 2017 The Chromium Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

:host {
    overflow: auto;
    background-color: var(--toolbar-bg-color);
}

.tree-outline-disclosure {
    max-width: 100%;
    padding-left: 6px;
}

.count {
    flex: none;
    margin: 0 8px;
}

[is=ui-icon] {
    margin: 0 5px;
}

[is=ui-icon].icon-mask {
    background-color: #555;
}

li {
    height: 24px;
}

li .largeicon-navigator-file {
    background: linear-gradient(45deg, hsl(48, 70%, 50%), hsl(48, 70%, 70%));
    margin: 0;
}

li .largeicon-navigator-folder {
    background: linear-gradient(45deg, hsl(210, 82%, 65%), hsl(210, 82%, 80%));
    margin: -3px -3px 0 -5px;
}

.tree-element-title {
    flex-shrink: 100;
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tree-outline li:hover:not(.selected) .selection {
    display: block;
    background-color: var(--item-hover-color);
}
`;