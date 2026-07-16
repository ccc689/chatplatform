/**
 * 数字方舟 Landing Page — Interactive Engine
 * Canvas Hero · Mouse Tracking · 3D Tilt · Scroll Animations
 */
(function() {
  'use strict';

  /* ==================== Mouse Tracking ==================== */
  var mouseX = window.innerWidth / 2;
  var mouseY = window.innerHeight / 2;
  var targetMouseX = mouseX;
  var targetMouseY = mouseY;
  var mouseOnPage = false;

  document.addEventListener('mousemove', function(e) {
    targetMouseX = e.clientX;
    targetMouseY = e.clientY;
    mouseOnPage = true;
  });
  document.addEventListener('mouseleave', function() {
    mouseOnPage = false;
  });

  /* ==================== Cursor Glow ==================== */
  var cursorGlow = document.createElement('div');
  cursorGlow.className = 'cursor-glow';
  document.body.appendChild(cursorGlow);

  /* ==================== Hero BG Parallax ==================== */
  var bgLayer1 = document.querySelector('.hero-bg-layer-1');
  var bgLayer2 = document.querySelector('.hero-bg-layer-2');
  var bgLayer3 = document.querySelector('.hero-bg-layer-3');

  /* ==================== Canvas Hero ==================== */
  var canvas = document.getElementById('heroCanvas');
  if (!canvas) {
    console.warn('Hero canvas not found');
    return;
  }
  var ctx = canvas.getContext('2d');

  var particles = [];
  var connections = [];
  var floatingCards = [];
  var width, height;

  function resizeCanvas() {
    var hero = document.querySelector('.hero');
    width = hero.offsetWidth;
    height = hero.offsetHeight;
    canvas.width = width;
    canvas.height = height;
  }

  /* ---- Particles ---- */
  function createParticles() {
    particles = [];
    var count = Math.floor((width * height) / 18000);
    count = Math.max(30, Math.min(count, 100));
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
        hue: Math.random() < 0.5 ? 240 + Math.random() * 30 : 190 + Math.random() * 20
      });
    }
  }

  /* ---- Floating Cards (abstract chat windows) ---- */
  function createFloatingCards() {
    floatingCards = [];
    var cardCount = 5;
    for (var i = 0; i < cardCount; i++) {
      floatingCards.push({
        x: Math.random() * width * 0.7 + width * 0.1,
        y: Math.random() * height * 0.55 + height * 0.1,
        w: 80 + Math.random() * 60,
        h: 50 + Math.random() * 40,
        baseX: 0, baseY: 0,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0003 + Math.random() * 0.0007,
        amplitude: 15 + Math.random() * 25,
        opacity: 0.06 + Math.random() * 0.08,
        rotation: (Math.random() - 0.5) * 8,
        hue: [240, 260, 200, 190, 220][i]
      });
      floatingCards[i].baseX = floatingCards[i].x;
      floatingCards[i].baseY = floatingCards[i].y;
    }
  }

  /* ---- Connections (data flow lines) ---- */
  function createConnections() {
    connections = [];
    for (var i = 0; i < floatingCards.length; i++) {
      for (var j = i + 1; j < floatingCards.length; j++) {
        if (Math.random() < 0.55) {
          connections.push({
            from: i,
            to: j,
            opacity: 0.03 + Math.random() * 0.04,
            flowOffset: Math.random()
          });
        }
      }
    }
  }

  /* ---- Draw Functions ---- */
  function drawParticles(time) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      // Mouse attraction (subtle)
      var dx = mouseX - p.x;
      var dy = mouseY - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 200 && mouseOnPage) {
        var force = (200 - dist) / 200 * 0.015;
        p.vx += dx * force * 0.01;
        p.vy += dy * force * 0.01;
      }

      // Velocity damping
      p.vx *= 0.995;
      p.vy *= 0.995;
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + p.hue + ', 70%, 65%, ' + p.opacity + ')';
      ctx.fill();
    }
  }

  function drawConnections(time) {
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      var a = floatingCards[c.from];
      var b = floatingCards[c.to];
      if (!a || !b) continue;

      var ax = a.x + a.w / 2;
      var ay = a.y + a.h / 2;
      var bx = b.x + b.w / 2;
      var by = b.y + b.h / 2;

      // Dashed line
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(99,102,241,' + c.opacity + ')';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.lineDashOffset = -time * 0.03;
      ctx.stroke();
      ctx.setLineDash([]);

      // Flow dot
      var flowPos = ((time * 0.0005 + c.flowOffset) % 1);
      var fx = ax + (bx - ax) * flowPos;
      var fy = ay + (by - ay) * flowPos;

      ctx.beginPath();
      ctx.arc(fx, fy, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99,102,241,0.35)';
      ctx.fill();
    }
  }

  function drawFloatingCards(time) {
    for (var i = 0; i < floatingCards.length; i++) {
      var card = floatingCards[i];

      // Floating animation
      card.x = card.baseX + Math.sin(time * card.speed + card.phase) * card.amplitude;
      card.y = card.baseY + Math.cos(time * card.speed * 1.3 + card.phase) * card.amplitude * 0.7;

      // Mouse parallax
      if (mouseOnPage) {
        var mx = (mouseX / width - 0.5) * 2;
        var my = (mouseY / height - 0.5) * 2;
        card.x += mx * 8;
        card.y += my * 8;
      }

      // Rounded rectangle
      var r = 10;
      var x = card.x, y = card.y, w = card.w, h = card.h;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();

      ctx.fillStyle = 'hsla(' + card.hue + ', 60%, 70%, ' + card.opacity + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Inner lines (chat message simulation)
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      var ly = y + 12;
      for (var li = 0; li < 2; li++) {
        var lineW = w * (0.4 + Math.random() * 0.3);
        ctx.fillRect(x + 10, ly, lineW, 2);
        ly += 8;
      }
    }
  }

  /* ---- Animation Loop ---- */
  function animate(time) {
    // Smooth mouse follow
    mouseX += (targetMouseX - mouseX) * 0.08;
    mouseY += (targetMouseY - mouseY) * 0.08;

    // Update cursor glow position
    cursorGlow.style.left = mouseX + 'px';
    cursorGlow.style.top = mouseY + 'px';
    cursorGlow.classList.toggle('active', mouseOnPage);

    // Parallax hero background
    if (bgLayer1 && bgLayer2 && bgLayer3) {
      var px = (mouseX / window.innerWidth - 0.5) * 10;
      var py = (mouseY / window.innerHeight - 0.5) * 10;
      if (mouseOnPage) {
        bgLayer1.style.transform = 'translate(' + px * 0.3 + 'px, ' + py * 0.3 + 'px)';
        bgLayer2.style.transform = 'translate(' + px * 0.6 + 'px, ' + py * 0.6 + 'px)';
        bgLayer3.style.transform = 'translate(' + px + 'px, ' + py + 'px)';
      } else {
        bgLayer1.style.transform = 'translate(0, 0)';
        bgLayer2.style.transform = 'translate(0, 0)';
        bgLayer3.style.transform = 'translate(0, 0)';
      }
    }

    // Draw canvas
    ctx.clearRect(0, 0, width, height);
    drawConnections(time);
    drawFloatingCards(time);
    drawParticles(time);

    requestAnimationFrame(animate);
  }

  /* ---- Resize Handler ---- */
  function handleResize() {
    resizeCanvas();
    createParticles();
    createFloatingCards();
    createConnections();
  }

  window.addEventListener('resize', handleResize);

  /* ---- Init Canvas ---- */
  resizeCanvas();
  createParticles();
  createFloatingCards();
  createConnections();
  requestAnimationFrame(animate);

  /* ==================== 3D Tilt on Cards ==================== */
  var tiltCards = document.querySelectorAll('.feature-card, .chat-showcase');

  tiltCards.forEach(function(card) {
    card.addEventListener('mousemove', function(e) {
      var rect = card.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var centerX = rect.width / 2;
      var centerY = rect.height / 2;
      var rotateX = (y - centerY) / centerY * -8;
      var rotateY = (x - centerX) / centerX * 8;

      card.style.transform = 'perspective(1000px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) translateY(-6px)';
    });

    card.addEventListener('mouseleave', function() {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
    });
  });

  /* ==================== Scroll Animations (Intersection Observer) ==================== */
  var fadeUpElements = document.querySelectorAll('.anim-fade-up');
  var staggerContainers = document.querySelectorAll('.anim-stagger');

  var observerOptions = { threshold: 0.15, rootMargin: '0px 0px -40px 0px' };

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  fadeUpElements.forEach(function(el) { observer.observe(el); });

  staggerContainers.forEach(function(container) {
    var children = container.children;
    var childObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry, index) {
        if (entry.isIntersecting) {
          // Stagger delay
          setTimeout(function() {
            entry.target.classList.add('visible');
          }, Array.prototype.indexOf.call(children, entry.target) * 80);
          childObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -20px 0px' });

    Array.from(children).forEach(function(child) { childObserver.observe(child); });
  });

  /* ==================== Navbar Scroll Effect ==================== */
  var navbar = document.getElementById('navbar');
  window.addEventListener('scroll', function() {
    if (navbar) {
      navbar.classList.toggle('scrolled', window.pageYOffset > 50);
    }
  }, { passive: true });

})();
