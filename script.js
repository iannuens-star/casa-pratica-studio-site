// Menu mobile, FAQ (uma resposta aberta por vez) e rolagem suave. Sem dependências.
document.documentElement.classList.add("js");

const menuBtn = document.querySelector(".menu-btn");
const menu = document.getElementById("menu");

function setMenu(open) {
  menu.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}

menuBtn.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && menu.classList.contains("open")) {
    setMenu(false);
    menuBtn.focus();
  }
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener("click", e => {
    const target = document.querySelector(link.getAttribute("href"));
    setMenu(false);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    history.pushState(null, "", link.getAttribute("href"));
  });
});

const faq = document.querySelectorAll("details");
faq.forEach(item => item.addEventListener("toggle", () => {
  if (item.open) faq.forEach(other => { if (other !== item) other.open = false; });
}));
