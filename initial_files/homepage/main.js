// Particle System
function createParticles() {
  const particlesContainer = document.getElementById('particles');
  const particleCount = 50;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';

    // Random animation
    anime({
      targets: particle,
      translateX: () => anime.random(-50, 50),
      translateY: () => anime.random(-50, 50),
      opacity: [0, 1, 0],
      duration: anime.random(3000, 6000),
      loop: true,
      easing: 'easeInOutSine'
    });

    particlesContainer.appendChild(particle);
  }
}

// Floating shapes animation
function animateShapes() {
  anime({
    targets: '.shape1',
    translateY: [-20, 20],
    rotate: [0, 360],
    duration: 8000,
    loop: true,
    easing: 'easeInOutSine'
  });

  anime({
    targets: '.shape2',
    translateX: [-15, 15],
    translateY: [10, -10],
    duration: 6000,
    loop: true,
    easing: 'easeInOutSine'
  });

  anime({
    targets: '.shape3',
    scale: [1, 1.2, 1],
    duration: 4000,
    loop: true,
    easing: 'easeInOutSine'
  });
}

// Hero entrance animation
function animateHero() {
  const tl = anime.timeline({
    easing: 'easeOutExpo',
  });

  tl.add({
    targets: '.hero-title',
    translateY: [100, 0],
    opacity: [0, 1],
    duration: 1200,
  }).add({
    targets: '.hero-subtitle',
    translateY: [50, 0],
    opacity: [0, 1],
    duration: 800,
    offset: '-=800'
  }).add({
    targets: '.hero-content p',
    translateY: [30, 0],
    opacity: [0, 1],
    duration: 600,
    offset: '-=400'
  }).add({
    targets: '.cta-button',
    scale: [0, 1],
    opacity: [0, 1],
    duration: 600,
    offset: '-=200'
  });
}

// Scroll reveal animation
function animateOnScroll() {
  const reveals = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');

        anime({
          targets: entry.target,
          translateY: [50, 0],
          opacity: [0, 1],
          duration: 800,
          easing: 'easeOutCubic'
        });
      }
    });
  }, { threshold: 0.1 });

  reveals.forEach(reveal => observer.observe(reveal));
}

// Feature cards hover animation
function animateFeatureCards() {
  const cards = document.querySelectorAll('.feature-card');

  cards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      anime({
        targets: card.querySelector('.feature-icon'),
        scale: [1, 1.2],
        rotate: [0, 5],
        duration: 300,
        easing: 'easeOutCubic'
      });
    });

    card.addEventListener('mouseleave', () => {
      anime({
        targets: card.querySelector('.feature-icon'),
        scale: [1.2, 1],
        rotate: [5, 0],
        duration: 300,
        easing: 'easeOutCubic'
      });
    });
  });
}

// Stats counter animation
function animateStats() {
  const statNumbers = document.querySelectorAll('.stat-number');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target;
        const finalValue = parseInt(target.dataset.target);

        anime({
          targets: target,
          innerHTML: [0, finalValue],
          round: 1,
          duration: 2000,
          easing: 'easeOutCubic',
          opacity: [0, 1],
          update: function (anim) {
            target.innerHTML = Math.round(anim.animatables[0].target.innerHTML);
          }
        });
      }
    });
  }, { threshold: 0.5 });

  statNumbers.forEach(stat => observer.observe(stat));
}

// Code typing animation
function animateCode() {
  const codeLines = document.querySelectorAll('.code-line');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        codeLines.forEach((line, index) => {
          anime({
            targets: line,
            translateX: [0, 0],
            opacity: [0, 1],
            duration: 800,
            delay: index * 200,
            easing: 'easeOutCubic'
          });
        });
      }
    });
  }, { threshold: 0.5 });

  const codeContainer = document.querySelector('.code-animation');
  if (codeContainer) observer.observe(codeContainer);
}

// Screenshot cards stagger animation
function animateScreenshots() {
  const cards = document.querySelectorAll('.screenshot-card');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        anime({
          targets: cards,
          translateY: [30, 0],
          opacity: [0, 1],
          delay: anime.stagger(100),
          duration: 600,
          easing: 'easeOutCubic'
        });
      }
    });
  }, { threshold: 0.2 });

  if (cards.length > 0) observer.observe(cards[0]);
}

// Smooth scrolling for navigation
function initSmoothScroll() {
  const navLinks = document.querySelectorAll('.nav-links a');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.getAttribute('href');
      const targetSection = document.querySelector(targetId);

      if (targetSection) {
        const offsetTop = targetSection.offsetTop - 80;

        anime({
          targets: document.documentElement,
          scrollTop: offsetTop,
          duration: 800,
          easing: 'easeInOutCubic'
        });
      }
    });
  });
}

// CTA button pulse animation
function animateCTAButton() {
  const ctaButtons = document.querySelectorAll('.cta-button');

  ctaButtons.forEach(button => {
    anime({
      targets: button,
      boxShadow: [
        '0 10px 30px rgba(102, 126, 234, 0.3)',
        '0 15px 40px rgba(102, 126, 234, 0.5)',
        '0 10px 30px rgba(102, 126, 234, 0.3)'
      ],
      duration: 2000,
      loop: true,
      easing: 'easeInOutSine'
    });
  });
}

// Navigation background on scroll
function animateNavOnScroll() {
  const nav = document.querySelector('.nav');
  let lastScrollY = window.scrollY;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 100) {
      nav.style.background = 'rgba(10, 14, 39, 0.95)';
    } else {
      nav.style.background = 'rgba(10, 14, 39, 0.9)';
    }

    // Hide nav on scroll down, show on scroll up
    if (window.scrollY > lastScrollY && window.scrollY > 200) {
      anime({
        targets: nav,
        translateY: -100,
        duration: 300,
        easing: 'easeOutCubic'
      });
    } else {
      anime({
        targets: nav,
        translateY: 0,
        duration: 300,
        easing: 'easeOutCubic'
      });
    }

    lastScrollY = window.scrollY;
  });
}

// Page load animations
function initPageAnimations() {
  // Create loading screen
  const loader = document.createElement('div');
  loader.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: var(--dark-bg);
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-direction: column;
            `;

  const loaderText = document.createElement('div');
  loaderText.innerHTML = '🌟 Pyxis';
  loaderText.style.cssText = `
                font-size: 3rem;
                font-weight: 800;
                background: var(--primary-gradient);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 20px;
            `;

  const loaderSubtext = document.createElement('div');
  loaderSubtext.innerHTML = '起動中...';
  loaderSubtext.style.cssText = `
                font-size: 1.2rem;
                color: var(--text-secondary);
                opacity: 0;
            `;

  loader.appendChild(loaderText);
  loader.appendChild(loaderSubtext);
  document.body.appendChild(loader);

  // Animate loader
  anime({
    targets: loaderText,
    scale: [0, 1],
    opacity: [0, 1],
    duration: 800,
    easing: 'easeOutCubic'
  });

  anime({
    targets: loaderSubtext,
    opacity: [0, 1],
    duration: 600,
    delay: 400,
    easing: 'easeOutCubic'
  });

  // Remove loader after delay
  setTimeout(() => {
    anime({
      targets: loader,
      opacity: [1, 0],
      duration: 500,
      easing: 'easeOutCubic',
      complete: () => {
        document.body.removeChild(loader);
        animateHero();
      }
    });
  }, 1500);
}

// Initialize all animations when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initPageAnimations();
  createParticles();
  animateShapes();
  animateOnScroll();
  animateFeatureCards();
  animateStats();
  animateCode();
  animateScreenshots();
  initSmoothScroll();
  animateCTAButton();
  animateNavOnScroll();
});

// Add some interactive elements
document.addEventListener('mousemove', (e) => {
  const shapes = document.querySelectorAll('.shape');
  const mouseX = e.clientX / window.innerWidth;
  const mouseY = e.clientY / window.innerHeight;

  shapes.forEach((shape, index) => {
    const speed = (index + 1) * 0.5;
    const x = (mouseX - 0.5) * speed * 20;
    const y = (mouseY - 0.5) * speed * 20;

    anime({
      targets: shape,
      translateX: x,
      translateY: y,
      duration: 1000,
      easing: 'easeOutCubic'
    });
  });
});

// Add easter egg - konami code
let konamiCode = [];
const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

document.addEventListener('keydown', (e) => {
  konamiCode.push(e.code);
  if (konamiCode.length > konamiSequence.length) {
    konamiCode.shift();
  }

  if (JSON.stringify(konamiCode) === JSON.stringify(konamiSequence)) {
    // Easter egg animation
    const particles = document.querySelectorAll('.particle');
    anime({
      targets: particles,
      scale: [1, 3, 1],
      rotate: [0, 360],
      backgroundColor: [
        'rgba(255, 255, 255, 0.1)',
        'rgba(255, 107, 157, 0.8)',
        'rgba(102, 126, 234, 0.8)',
        'rgba(255, 255, 255, 0.1)'
      ],
      duration: 2000,
      delay: anime.stagger(50),
      easing: 'easeInOutSine'
    });

    // Show secret message
    const secretMsg = document.createElement('div');
    secretMsg.innerHTML = '🎉 コナミコード発見！Pyxisの隠し機能アクティブ！';
    secretMsg.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: var(--primary-gradient);
                    padding: 20px 40px;
                    border-radius: 50px;
                    color: white;
                    font-weight: 600;
                    z-index: 10000;
                    font-size: 1.2rem;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
                `;

    document.body.appendChild(secretMsg);

    anime({
      targets: secretMsg,
      scale: [0, 1],
      opacity: [0, 1],
      duration: 500,
      easing: 'easeOutCubic',
      complete: () => {
        setTimeout(() => {
          anime({
            targets: secretMsg,
            scale: [1, 0],
            opacity: [1, 0],
            duration: 500,
            easing: 'easeInCubic',
            complete: () => document.body.removeChild(secretMsg)
          });
        }, 3000);
      }
    });

    konamiCode = [];
  }
});