import React, { useState } from 'react';

/* ======================================
TYPE on Terminal

react-build react/sample.jsx --tailwind

======================================*/





// --- Data & Assets ---

const IMAGES = {
  hero: "https://images.unsplash.com/photo-1486325212027-8081e485255e?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80",
  about: "https://images.unsplash.com/photo-1497366216548-37526070297c?ixlib=rb-4.0.3&auto=format&fit=crop&w=2301&q=80",
  project1: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?ixlib=rb-4.0.3&auto=format&fit=crop&w=1770&q=80",
  project2: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?ixlib=rb-4.0.3&auto=format&fit=crop&w=2653&q=80",
  project3: "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?ixlib=rb-4.0.3&auto=format&fit=crop&w=1770&q=80",
};

const PROJECTS = [
  { id: 1, title: "The Glass Horizon", category: "Residential", image: IMAGES.project1 },
  { id: 2, title: "Eco-Vertex HQ", category: "Commercial", image: IMAGES.project2 },
  { id: 3, title: "Serenity Villa", category: "Residential", image: IMAGES.project3 },
];

const Icons = {
  Menu: () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
  ),
  X: () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
  ),
  Leaf: () => (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 20c-4.5 0-8-4-8-9 0-5 5-9 9-9s9 4 9 9c0 5-3.5 9-8 9zM11 20v-9" /></svg>
  ),
  Building: () => (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m8-10h2M7 21h10" /></svg>
  ),
  Award: () => (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15l-2 5l2-1l2 1l-2-5zm0-11a4 4 0 100 8 4 4 0 000-8z" /></svg>
  ),
  ArrowRight: () => (
    <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
  )
};

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed w-full bg-white/90 backdrop-blur-sm z-50 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20 items-center">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <span className="text-2xl font-serif font-bold tracking-wider text-gray-900">LUMINA</span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex space-x-8 items-center">
            <a href="#home" className="text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium tracking-wide">HOME</a>
            <a href="#about" className="text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium tracking-wide">ABOUT</a>
            <a href="#projects" className="text-gray-500 hover:text-gray-900 transition-colors text-sm font-medium tracking-wide">PROJECTS</a>
            <a href="#contact" className="bg-gray-900 text-white px-5 py-2 rounded-sm hover:bg-gray-800 transition-colors text-sm font-medium">CONTACT</a>
          </div>

          {/* Mobile Button */}
          <div className="md:hidden flex items-center">
            <button onClick={() => setIsOpen(!isOpen)} className="text-gray-500 hover:text-gray-900 focus:outline-none">
              {isOpen ? <Icons.X /> : <Icons.Menu />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white border-b border-gray-100 absolute w-full">
          <div className="px-4 pt-2 pb-6 space-y-2">
            <a href="#home" className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-50">Home</a>
            <a href="#about" className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-50">About</a>
            <a href="#projects" className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-50">Projects</a>
            <a href="#contact" className="block px-3 py-2 text-base font-medium text-gray-900 font-bold hover:bg-gray-50">Contact Us</a>
          </div>
        </div>
      )}
    </nav>
  );
};

const Hero = () => (
  <div id="home" className="relative h-screen w-full overflow-hidden">
    <div className="absolute inset-0">
      <img src={IMAGES.hero} alt="Modern Architecture" className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gray-900/40"></div>
    </div>
    <div className="relative max-w-7xl mx-auto px-4 h-full flex items-center">
      <div className="text-white max-w-2xl">
        <h1 className="text-5xl md:text-7xl font-serif font-medium mb-6 leading-tight">
          Designing the Future, <br /> Respecting the Past.
        </h1>
        <p className="text-lg md:text-xl text-gray-200 mb-10 font-light max-w-lg">
          Lumina Architecture blends sustainable innovation with timeless design to create spaces that inspire.
        </p>
        <a href="#projects" className="inline-flex items-center border border-white text-white px-8 py-3 hover:bg-white hover:text-gray-900 transition-all duration-300 tracking-widest text-sm">
          VIEW PORTFOLIO
          <Icons.ArrowRight />
        </a>
      </div>
    </div>
  </div>
);

const Services = () => (
  <section className="py-24 bg-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-serif font-medium text-gray-900 mb-4">Our Expertise</h2>
        <div className="w-16 h-0.5 bg-gray-300 mx-auto"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
        {/* Service 1 */}
        <div className="text-center group p-6 hover:bg-gray-50 transition-colors duration-300">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-800 group-hover:bg-gray-200 transition-colors">
            <Icons.Building />
          </div>
          <h3 className="text-xl font-medium text-gray-900 mb-3">Urban Planning</h3>
          <p className="text-gray-500 leading-relaxed">
            Integrating modern structures into evolving cityscapes with a focus on community and flow.
          </p>
        </div>

        {/* Service 2 */}
        <div className="text-center group p-6 hover:bg-gray-50 transition-colors duration-300">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-800 group-hover:bg-gray-200 transition-colors">
            <Icons.Leaf />
          </div>
          <h3 className="text-xl font-medium text-gray-900 mb-3">Sustainable Design</h3>
          <p className="text-gray-500 leading-relaxed">
            Eco-conscious materials and energy-efficient systems that reduce carbon footprints.
          </p>
        </div>

        {/* Service 3 */}
        <div className="text-center group p-6 hover:bg-gray-50 transition-colors duration-300">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-800 group-hover:bg-gray-200 transition-colors">
            <Icons.Award />
          </div>
          <h3 className="text-xl font-medium text-gray-900 mb-3">Interior Renovation</h3>
          <p className="text-gray-500 leading-relaxed">
            Transforming existing spaces into modern sanctuaries through light, space, and texture.
          </p>
        </div>
      </div>
    </div>
  </section>
);

const About = () => (
  <section id="about" className="py-24 bg-gray-50">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="relative h-96 lg:h-[600px]">
          <img src={IMAGES.about} alt="Architects working" className="w-full h-full object-cover shadow-xl" />
          <div className="absolute -bottom-6 -right-6 bg-white p-8 shadow-lg hidden md:block">
            <p className="text-4xl font-serif font-bold text-gray-900">15+</p>
            <p className="text-gray-500 text-sm tracking-wider uppercase mt-1">Years Experience</p>
          </div>
        </div>
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-medium text-gray-900 mb-6">
            We build environments that shape how you live.
          </h2>
          <p className="text-gray-600 text-lg mb-6 leading-relaxed">
            At Lumina, we believe architecture is more than just shelter—it's a dialogue between human needs and the natural environment. Founded in 2010, our firm has been at the forefront of the sustainable luxury movement.
          </p>
          <p className="text-gray-600 mb-8 leading-relaxed">
            Our team of 20+ architects and designers work collaboratively to deliver projects that stand the test of time, both aesthetically and structurally.
          </p>
          <button className="border-b border-gray-900 text-gray-900 pb-1 hover:text-gray-600 hover:border-gray-600 transition-colors font-medium">
            READ OUR STORY
          </button>
        </div>
      </div>
    </div>
  </section>
);

const Portfolio = () => (
  <section id="projects" className="py-24 bg-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-end mb-12">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-medium text-gray-900 mb-2">Selected Works</h2>
          <p className="text-gray-500">A glimpse into our recent architectural endeavors.</p>
        </div>
        <a href="#" className="hidden md:flex items-center text-sm font-medium text-gray-900 hover:text-gray-600">
          VIEW ALL <Icons.ArrowRight />
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {PROJECTS.map((project) => (
          <div key={project.id} className="group cursor-pointer">
            <div className="relative overflow-hidden mb-4 h-80">
              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors duration-500 z-10"></div>
              <img
                src={project.image}
                alt={project.title}
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 ease-out"
              />
            </div>
            <h3 className="text-xl font-medium text-gray-900 group-hover:text-gray-600 transition-colors">{project.title}</h3>
            <p className="text-sm text-gray-500 mt-1 uppercase tracking-wider">{project.category}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 text-center md:hidden">
        <a href="#" className="inline-flex items-center text-sm font-medium text-gray-900 border border-gray-300 px-6 py-3">
          VIEW ALL PROJECTS
        </a>
      </div>
    </div>
  </section>
);

const Contact = () => (
  <section id="contact" className="py-24 bg-gray-900 text-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
        <div>
          <h2 className="text-3xl md:text-4xl font-serif font-medium mb-6">Start your project</h2>
          <p className="text-gray-400 mb-10 text-lg">
            Ready to bring your vision to life? Contact our team for a consultation on your next residential or commercial project.
          </p>

          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-2">Address</h4>
              <p className="text-white">1024 Innovation Blvd, Suite 500<br />Tokyo, Japan 100-0001</p>
            </div>
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-2">Email</h4>
              <p className="text-white">hello@lumina-arch.com</p>
            </div>
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-2">Phone</h4>
              <p className="text-white">+81 (0)3 1234 5678</p>
            </div>
          </div>
        </div>

        <div className="bg-white/5 p-8 rounded-sm border border-white/10">
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
              <input type="text" className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 focus:outline-none focus:border-white transition-colors" placeholder="John Doe" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
              <input type="email" className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 focus:outline-none focus:border-white transition-colors" placeholder="john@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Message</label>
              <textarea rows="4" className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 focus:outline-none focus:border-white transition-colors" placeholder="Tell us about your project..."></textarea>
            </div>
            <button className="w-full bg-white text-gray-900 font-bold py-4 hover:bg-gray-200 transition-colors">
              SEND MESSAGE
            </button>
          </form>
        </div>
      </div>
    </div>
  </section>
);

const Footer = () => (
  <footer className="bg-black text-white py-12 border-t border-gray-800">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
      <div className="mb-4 md:mb-0">
        <span className="text-2xl font-serif font-bold tracking-wider">LUMINA</span>
      </div>
      <div className="flex space-x-6 text-sm text-gray-400">
        <a href="#" className="hover:text-white transition-colors">Instagram</a>
        <a href="#" className="hover:text-white transition-colors">LinkedIn</a>
        <a href="#" className="hover:text-white transition-colors">Twitter</a>
      </div>
      <div className="mt-4 md:mt-0 text-gray-500 text-xs">
        &copy; 2024 Lumina Architecture. All rights reserved.
      </div>
    </div>
  </footer>
);

// --- Main App Component ---

export default function App() {
  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 scroll-smooth">
      <Navbar />
      <main>
        <Hero />
        <Services />
        <About />
        <Portfolio />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
