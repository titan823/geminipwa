// Regression test for native iOS/Android chat text selection.
// Runs offline without any API keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('handleTouchStart(event) {');
const end = html.indexOf('toggleMemo() {', start);
assert.ok(start >= 0 && end > start, 'production touch handlers exist');
const methods = html.slice(start, end);
assert.doesNotMatch(methods, /getSelection\(\)\.toString\(\)/);

// Execute actual source code; do not duplicate the implementation under test.
const createHandler = new Function(
  'state', 'window', 'uiUtils', 'SWIPE_THRESHOLD',
  `return ({ ${methods} });`
);

function setup() {
  const state = {
    settings: { enableSwipeNavigation: true },
    touchStartX: 0, touchStartY: 0,
    touchEndX: 0, touchEndY: 0,
    isSwiping: false, isZoomed: false,
  };
  let hasSelection = false;
  const screens = [];
  const window = {
    getSelection() {
      return {
        isCollapsed: !hasSelection,
        toString() {
          throw Error('selection content should never be copied on touch');
        }
      };
    }
  };
  const handlers = createHandler(
    state, window, { showScreen(screen) { screens.push(screen); } }, 50
  );
  handlers.updateZoomState = () => {};

  function event(isMessage, x = 160, y = 60) {
    return {
      target: {
        tagName: 'P',
        closest(selector) {
          assert.match(selector, /message-content/);
          return isMessage ? {} : null;
        }
      },
      touches: [{ clientX: x, clientY: y }],
      cancelable: true,
      prevented: false,
      preventDefault() { this.prevented = true; }
    };
  }
  return {
    handlers, state, screens, event,
    setSelection(value) { hasSelection = value; }
  };
}

// A long press and subsequent drag in a message is never a navigation swipe.
{
  const t = setup();
  t.handlers.handleTouchStart(t.event(true));
  const drag = t.event(true, 25);
  t.handlers.handleTouchMove(drag);
  t.handlers.handleTouchEnd(drag);
  assert.equal(drag.prevented, false);
  assert.equal(t.state.isSwiping, false);
  assert.deepEqual(t.screens, []);
}

// A selection beginning mid-gesture also cancels any pending swipe.
{
  const t = setup();
  t.handlers.handleTouchStart(t.event(false));
  t.setSelection(true);
  const drag = t.event(false, 25);
  t.handlers.handleTouchMove(drag);
  t.handlers.handleTouchEnd(drag);
  assert.equal(drag.prevented, false);
  assert.equal(t.state.touchStartX, 0);
  assert.deepEqual(t.screens, []);
}

// Horizontal navigation remains usable from non-message areas.
{
  const t = setup();
  t.handlers.handleTouchStart(t.event(false));
  const drag = t.event(false, 25);
  t.handlers.handleTouchMove(drag);
  t.handlers.handleTouchEnd(drag);
  assert.equal(drag.prevented, true);
  assert.deepEqual(t.screens, ['settings']);
}

assert.match(html, /#chat-screen \.message-content,[\s\S]*?-webkit-user-select: text;/);
assert.match(html, /Do not change bubble layout during native text selection\.[\s\S]*?getSelection\(\)\?\.isCollapsed === false/);
assert.match(html, /const APP_VERSION = "0\.26ti \(627b4\)";/);
console.log('PASS: titan823 mobile native text selection and swipe regressions');
