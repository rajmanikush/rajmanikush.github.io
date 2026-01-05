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
