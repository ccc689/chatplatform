/**
 * 数字方舟 — 登录页数字生命体交互引擎
 * 眼睛跟踪 · 输入框响应 · 呼吸漂浮 · 眨眼 · 鼠标靠近反应
 */
(function() {
  'use strict';

  /* ==================== State ==================== */
  var mouseX = window.innerWidth / 2;
  var mouseY = window.innerHeight / 2;
  var targetMouseX = mouseX;
  var targetMouseY = mouseY;
  var activeInput = null;       // 'username' | 'password' | null
  var time = 0;
  var characters = [];

  /* ==================== Character Config ==================== */
  // Each character: { id, container, eyeL, eyeR, pupilL, pupilR, eyelidL, eyelidR,
  //   lidL, lidR (the eyelid clip paths), handL, handR, body, mouth,
  //   baseX, baseY, floatPhase, blinkTimer, blinkState, isClosing,
  //   coverState: 'none'|'peeking'|'covered' }

  /* ==================== Mouse Tracking ==================== */
  document.addEventListener('mousemove', function(e) {
    targetMouseX = e.clientX;
    targetMouseY = e.clientY;
  });

  /* ==================== Initialize Characters ==================== */
  function initCharacters() {
    var containers = document.querySelectorAll('.char-container');
    containers.forEach(function(container) {
      var svg = container.querySelector('svg');
      if (!svg) return;

      var char = {
        id: container.dataset.char,
        container: container,
        svg: svg,
        // Eye elements
        eyeL: svg.querySelector('.eye-left'),
        eyeR: svg.querySelector('.eye-right'),
        pupilL: svg.querySelector('.pupil-left'),
        pupilR: svg.querySelector('.pupil-right'),
        eyelidTopL: svg.querySelector('.eyelid-top-left'),
        eyelidTopR: svg.querySelector('.eyelid-top-right'),
        eyelidBotL: svg.querySelector('.eyelid-bot-left'),
        eyelidBotR: svg.querySelector('.eyelid-bot-right'),
        // Hands (for covering eyes on password)
        handL: svg.querySelector('.hand-left'),
        handR: svg.querySelector('.hand-right'),
        // Body for breathing
        body: svg.querySelector('.char-body'),
        mouth: svg.querySelector('.char-mouth'),
        // Animation state
        floatPhase: Math.random() * Math.PI * 2,
        breathePhase: Math.random() * Math.PI * 2,
        blinkTimer: 2000 + Math.random() * 3000,
        blinkElapsed: 0,
        isClosing: false,
        blinkProgress: 0,
        coverState: 'none',
        coverProgress: 0,
        // Position tracking
        rect: null,
        centerX: 0,
        centerY: 0,
        // Smooth pupil offset
        pupilOffX: 0,
        pupilOffY: 0,
        targetPupilOffX: 0,
        targetPupilOffY: 0,
        // Mouse proximity
        mouseNear: false,
        nearProgress: 0
      };

      characters.push(char);
    });
  }

  /* ==================== Update Positions ==================== */
  function updatePositions() {
    characters.forEach(function(char) {
      char.rect = char.container.getBoundingClientRect();
      char.centerX = char.rect.left + char.rect.width / 2;
      char.centerY = char.rect.top + char.rect.height / 2;
    });
  }

  /* ==================== Eye Tracking Math ==================== */
  function calcEyeTarget(char, targetWorldX, targetWorldY) {
    // Vector from character center to target
    var dx = targetWorldX - char.centerX;
    var dy = targetWorldY - char.centerY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    // Max pupil offset (in SVG units, depends on eye size)
    var maxOffset = 8;
    if (char.id === 'pixel') maxOffset = 10; // Pixel has wider eyes

    // Clamp
    var maxDist = 300;
    var factor = Math.min(dist / maxDist, 1);
    var angle = Math.atan2(dy, dx);

    char.targetPupilOffX = Math.cos(angle) * maxOffset * factor;
    char.targetPupilOffY = Math.sin(angle) * maxOffset * factor;
  }

  /* ==================== Input Focus Handlers ==================== */
  var loginUserInput, loginPassInput, regUserInput, regPassInput, regPass2Input;

  function bindInputEvents() {
    loginUserInput = document.getElementById('loginUser');
    loginPassInput = document.getElementById('loginPass');
    regUserInput = document.getElementById('regUser');
    regPassInput = document.getElementById('regPass');
    regPass2Input = document.getElementById('regPass2');

    var usernameInputs = [loginUserInput, regUserInput];
    var passwordInputs = [loginPassInput, regPassInput, regPass2Input];

    usernameInputs.forEach(function(input) {
      if (!input) return;
      input.addEventListener('focus', function() {
        activeInput = 'username';
      });
      input.addEventListener('blur', function() {
        if (activeInput === 'username') activeInput = null;
      });
    });

    passwordInputs.forEach(function(input) {
      if (!input) return;
      input.addEventListener('focus', function() {
        activeInput = 'password';
      });
      input.addEventListener('blur', function() {
        if (activeInput === 'password') activeInput = null;
      });
    });
  }

  /* ==================== Input-Directed Gaze ==================== */
  function getInputTarget() {
    // Look toward the username input field
    var targetInput = loginUserInput || regUserInput;
    if (document.getElementById('loginForm').classList.contains('active')) {
      targetInput = loginUserInput;
    } else {
      targetInput = regUserInput;
    }

    if (targetInput) {
      var rect = targetInput.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: mouseX, y: mouseY };
  }

  /* ==================== Animation Loop ==================== */
  function animate(timestamp) {
    if (!time) time = timestamp;
    var dt = Math.min(timestamp - time, 50); // cap at 50ms
    time = timestamp;

    // Smooth mouse
    mouseX += (targetMouseX - mouseX) * 0.1;
    mouseY += (targetMouseY - mouseY) * 0.1;

    updatePositions();

    characters.forEach(function(char) {
      var dtSec = dt / 1000;

      /* ---- Determine eye target ---- */
      var targetX, targetY;
      if (activeInput === 'username') {
        var it = getInputTarget();
        targetX = it.x;
        targetY = it.y;
      } else if (activeInput === 'password') {
        // Look away / down (simulate hiding)
        targetX = char.centerX + (char.id === 'nova' ? -60 : char.id === 'pixel' ? 60 : 0);
        targetY = char.centerY + 80;
      } else {
        targetX = mouseX;
        targetY = mouseY;
      }

      calcEyeTarget(char, targetX, targetY);

      /* ---- Smooth pupil movement ---- */
      char.pupilOffX += (char.targetPupilOffX - char.pupilOffX) * 0.15;
      char.pupilOffY += (char.targetPupilOffY - char.pupilOffY) * 0.15;

      /* ---- Mouse proximity ---- */
      var dx = mouseX - char.centerX;
      var dy = mouseY - char.centerY;
      var distToMouse = Math.sqrt(dx * dx + dy * dy);
      var nearTarget = distToMouse < 250 ? 1 : 0;
      char.nearProgress += (nearTarget - char.nearProgress) * 0.08;

      /* ---- Blinking ---- */
      char.blinkElapsed += dt;
      if (!char.isClosing) {
        if (char.blinkElapsed > char.blinkTimer) {
          char.isClosing = true;
          char.blinkProgress = 0;
          char.blinkElapsed = 0;
          char.blinkTimer = 2000 + Math.random() * 4000;
        }
      }

      if (char.isClosing) {
        char.blinkProgress += dt / 150; // 150ms close+open
        if (char.blinkProgress >= 1) {
          char.blinkProgress = 0;
          char.isClosing = false;
        }
      }

      /* ---- Cover state (password) ---- */
      var coverTarget = activeInput === 'password' ? 1 : 0;
      char.coverProgress += (coverTarget - char.coverProgress) * 0.12;
      char.coverState = char.coverProgress > 0.8 ? 'covered' : char.coverProgress > 0.3 ? 'peeking' : 'none';

      /* ---- Apply to SVG ---- */
      updateCharacterSVG(char);
    });

    requestAnimationFrame(animate);
  }

  /* ==================== Update SVG Elements ==================== */
  function updateCharacterSVG(char) {
    var blink = char.isClosing ?
      Math.sin(char.blinkProgress * Math.PI) : // bell curve
      0;
    var cover = char.coverProgress;

    // Breathing scale
    char.breathePhase += 0.008;
    var breatheScale = 1 + Math.sin(char.breathePhase) * 0.015;

    // Floating offset
    char.floatPhase += 0.006;
    var floatY = Math.sin(char.floatPhase) * 8;

    // Apply float to container
    char.container.style.transform =
      'translateY(' + floatY + 'px) scale(' + breatheScale + ')';

    // Apply near reaction (slight lean toward mouse + glow)
    var leanX = char.nearProgress *
      (mouseX - char.centerX) / Math.max(Math.abs(mouseX - char.centerX), 1) * 3;
    var leanY = char.nearProgress *
      (mouseY - char.centerY) / Math.max(Math.abs(mouseY - char.centerY), 1) * 2;

    char.container.style.transform +=
      ' rotateX(' + (-leanY) + 'deg) rotateY(' + leanX + 'deg)';
    char.container.style.filter =
      'drop-shadow(0 0 ' + (8 + char.nearProgress * 14) + 'px rgba(99,102,241,' + (0.25 + char.nearProgress * 0.35) + '))';

    // Pupils
    if (char.pupilL) {
      char.pupilL.setAttribute('cx',
        (parseFloat(char.pupilL.getAttribute('data-cx') || 0) + char.pupilOffX).toString());
      char.pupilL.setAttribute('cy',
        (parseFloat(char.pupilL.getAttribute('data-cy') || 0) + char.pupilOffY).toString());
    }
    if (char.pupilR) {
      char.pupilR.setAttribute('cx',
        (parseFloat(char.pupilR.getAttribute('data-cx') || 0) + char.pupilOffX).toString());
      char.pupilR.setAttribute('cy',
        (parseFloat(char.pupilR.getAttribute('data-cy') || 0) + char.pupilOffY).toString());
    }

    // Eyelids (blink)
    var lidClose = blink * 0.5 + cover * 0.5;
    [char.eyelidTopL, char.eyelidTopR].forEach(function(lid) {
      if (lid) lid.setAttribute('opacity', lidClose.toString());
    });
    [char.eyelidBotL, char.eyelidBotR].forEach(function(lid) {
      if (lid) lid.setAttribute('opacity', lidClose.toString());
    });

    // Hands cover eyes for password
    if (char.handL) {
      char.handL.setAttribute('opacity', cover.toString());
      var hlX = 0 - cover * 18; // move in
      char.handL.setAttribute('transform', 'translate(' + hlX + ', 0)');
    }
    if (char.handR) {
      char.handR.setAttribute('opacity', cover.toString());
      var hrX = 0 + cover * 18;
      char.handR.setAttribute('transform', 'translate(' + hrX + ', 0)');
    }

    // Mouth changes
    if (char.mouth) {
      if (cover > 0.5) {
        char.mouth.setAttribute('d', 'M 85 128 Q 100 122 115 128'); // worried
      } else if (char.nearProgress > 0.5) {
        char.mouth.setAttribute('d', 'M 82 125 Q 100 138 118 125'); // happy
      } else {
        char.mouth.setAttribute('d', 'M 85 128 Q 100 132 115 128'); // neutral smile
      }
    }
  }

  /* ==================== Store Default Pupil Positions ==================== */
  function storeDefaultPositions() {
    characters.forEach(function(char) {
      if (char.pupilL) {
        char.pupilL.setAttribute('data-cx', char.pupilL.getAttribute('cx'));
        char.pupilL.setAttribute('data-cy', char.pupilL.getAttribute('cy'));
      }
      if (char.pupilR) {
        char.pupilR.setAttribute('data-cx', char.pupilR.getAttribute('cx'));
        char.pupilR.setAttribute('data-cy', char.pupilR.getAttribute('cy'));
      }
    });
  }

  /* ==================== Tab switching — rebind inputs ==================== */
  function overrideSwitchTab() {
    if (window.switchTab) {
      var origSwitchTab = window.switchTab;
      window.switchTab = function(tab) {
        origSwitchTab(tab);
        activeInput = null;
        characters.forEach(function(c) { c.coverProgress = 0; });
        setTimeout(bindInputEvents, 100);
      };
    }
  }

  /* ==================== Init ==================== */
  function init() {
    initCharacters();
    storeDefaultPositions();
    // Delay switchTab override to ensure inline script runs first
    setTimeout(overrideSwitchTab, 0);
    bindInputEvents();
    updatePositions();
    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
