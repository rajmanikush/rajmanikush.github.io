// Mobile Menu Toggle
const mobileMenuButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');
const menuIcon = document.getElementById('menu-icon');
const closeIcon = document.getElementById('close-icon');

mobileMenuButton.addEventListener('click', () => {
	mobileMenu.classList.toggle('hidden');
	menuIcon.classList.toggle('hidden');
	closeIcon.classList.toggle('hidden');
});

// Close mobile menu when clicking on a link
const mobileLinks = mobileMenu.querySelectorAll('a');
mobileLinks.forEach(link => {
	link.addEventListener('click', () => {
		mobileMenu.classList.add('hidden');
		menuIcon.classList.remove('hidden');
		closeIcon.classList.add('hidden');
	});
});

// Intersection Observer for fade-in animations
const observerOptions = {
	threshold: 0.1,
	rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
	entries.forEach(entry => {
		if (entry.isIntersecting) {
			entry.target.style.opacity = '1';
			entry.target.style.transform = 'translateY(0)';
		}
	});
}, observerOptions);

// Observe all elements with fade-in class (except hero elements)
const fadeElements = document.querySelectorAll('.fade-in');
fadeElements.forEach(el => {
	// Don't observe hero elements, let them animate immediately
	if (!el.closest('.hero-bg')) {
		observer.observe(el);
	}
});

// ── Scroll Progress Bar ──
// Uses requestAnimationFrame for smooth, performant updates.
// Calculates: scrolled / (totalScrollableHeight) * 100
const scrollProgressBar = document.getElementById('scroll-progress');

let ticking = false;
function updateScrollProgress() {
	const scrollTop = window.scrollY;
	const docHeight = document.documentElement.scrollHeight - window.innerHeight;
	const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
	scrollProgressBar.style.width = scrollPercent + '%';
	ticking = false;
}

window.addEventListener('scroll', () => {
	if (!ticking) {
		requestAnimationFrame(() => {
			updateScrollProgress();
			updateActiveNav();
		});
		ticking = true;
	}
}, { passive: true });

// ── Nav Active State ──
// Uses IntersectionObserver to detect which section is in view,
// then adds .active to the matching desktop nav link.
const sections = document.querySelectorAll('#overview, #experience, #skills, #portfolio, #resume, #contact');
const navLinks = document.querySelectorAll('.nav-link');

// Map each section ID to its corresponding nav link
const navMap = {};
navLinks.forEach(link => {
	const id = link.getAttribute('href').substring(1); // strip the #
	navMap[id] = link;
});

// Track which sections are currently intersecting
const activeSections = new Set();

function updateActiveNav() {
	// At the bottom of the page, activate the last section (Contact)
	const atBottom = (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 50;
	if (atBottom && activeSections.size > 0) {
		navLinks.forEach(link => link.classList.remove('active'));
		// Pick the last section in DOM order that's intersecting
		const lastSection = Array.from(sections).reverse().find(s => activeSections.has(s.id));
		if (lastSection && navMap[lastSection.id]) {
			navMap[lastSection.id].classList.add('active');
		}
		return;
	}

	// Otherwise, pick the topmost visible section (first in DOM order)
	for (const section of sections) {
		if (activeSections.has(section.id)) {
			navLinks.forEach(link => link.classList.remove('active'));
			if (navMap[section.id]) {
				navMap[section.id].classList.add('active');
			}
			return;
		}
	}
	// If no section is intersecting (e.g. at very top), clear all
	navLinks.forEach(link => link.classList.remove('active'));
}

const navObserver = new IntersectionObserver((entries) => {
	entries.forEach(entry => {
		if (entry.isIntersecting) {
			activeSections.add(entry.target.id);
		} else {
			activeSections.delete(entry.target.id);
		}
	});
	updateActiveNav();
}, {
	// rootMargin: negative top pulls the trigger zone down from the nav bar,
	// negative bottom ensures only the section near the top of viewport wins
	rootMargin: '-80px 0px -35% 0px',
	threshold: 0
});

sections.forEach(section => navObserver.observe(section));
