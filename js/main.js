// ── Dark Mode Toggle ──
const themeToggle = document.getElementById('theme-toggle');
const sunIcon = document.getElementById('theme-sun');
const moonIcon = document.getElementById('theme-moon');

function syncToggleIcons() {
	const isDark = document.documentElement.classList.contains('dark');
	sunIcon.classList.toggle('hidden', !isDark);
	moonIcon.classList.toggle('hidden', isDark);
}
syncToggleIcons();

themeToggle.addEventListener('click', () => {
	const isDark = document.documentElement.classList.toggle('dark');
	localStorage.setItem('theme', isDark ? 'dark' : 'light');
	syncToggleIcons();
});

// Sync with system preference changes when no stored preference
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
	if (!localStorage.getItem('theme')) {
		document.documentElement.classList.toggle('dark', e.matches);
		syncToggleIcons();
	}
});

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
// Uses getBoundingClientRect on each scroll to find the section whose top
// has most recently crossed the nav trigger line. Iterating in DOM order and
// keeping the last match means we always highlight the section the user is
// currently reading, even when multiple sections are partially in view.
const sections = document.querySelectorAll('#overview, #experience, #skills, #portfolio, #resume, #contact');
const navLinks = document.querySelectorAll('.nav-link');

// Map each section ID to its corresponding nav link
const navMap = {};
navLinks.forEach(link => {
	const id = link.getAttribute('href').substring(1); // strip the #
	navMap[id] = link;
});

function updateActiveNav() {
	// At the very bottom of the page, activate the last section (Contact)
	// even if its top hasn't crossed the trigger line (short footer edge case).
	const atBottom = (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 4;
	if (atBottom) {
		navLinks.forEach(link => link.classList.remove('active'));
		const lastSection = sections[sections.length - 1];
		if (navMap[lastSection.id]) navMap[lastSection.id].classList.add('active');
		return;
	}

	// Trigger line: just below the sticky nav (~80px tall) plus a small buffer
	const triggerPoint = 100;
	let active = null;

	// Walk sections in DOM order; the last one whose top is at/above the
	// trigger line is the one currently being viewed.
	for (const section of sections) {
		if (section.getBoundingClientRect().top <= triggerPoint) {
			active = section;
		}
	}

	navLinks.forEach(link => link.classList.remove('active'));
	if (active && navMap[active.id]) {
		navMap[active.id].classList.add('active');
	}
}

// Run once on load to set active state for direct links (e.g. #skills)
updateActiveNav();
