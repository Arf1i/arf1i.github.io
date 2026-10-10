const translations = {
  ru: {
    headline: "Привет)",
    lede: "Я монтирую видео.",
    aboutTitle: "О себе",
    aboutBody: [
      "Я Арфи, опытный монтажёр.",
      'Уже больше чем 10 лет я варюсь в блогинге - занимаясь этим сам и изучая других медиа личностей. Поэтому я привык вникать в стиль человека и его целевую аудиторию, не используя "универсальный" стиль монтажа для каждого.',
      "Более 6 лет я занимаюсь видеомонтажом, начиная с мобильного устройства. А в 2025 взялся за развития своих навыков серьёзно, и в данный момент беру заказы на монтаж.",
    ],
    skillsTitle: "Скиллы",
    skillsBody: [
      "Я используюсь Adobe Premiere Pro, Adobe After Effects, Adobe Photoshop, FL Studio (для sfx).",
      "Сейчас я не открыт для заказов на длинные видео (10min+) с комплексной графикой",
      "Моё портфолио --> https://t.me/arfi_edit",
    ],
    contactsTitle: "Контакты",
    contactsBody: "Если хотите работать вместе, свяжитесь со мной!",
    contactsLabel: "Контакты",
    telegramLabel: "Telegram",
    emailLabel: "Почта",
    discordLabel: "Discord",
    footer: "© Arfi",
    htmlLang: "ru",
  },
  en: {
    headline: "Hey!",
    lede: "I edit video.",
    aboutTitle: "About",
    aboutBody: [
      "I'm Arfi, an experienced editor.",
      "I've been in blogging for more than 10 years — doing it myself and studying other media personalities. So I'm used to getting into a person's style and their audience, instead of using a \"universal\" editing style for everyone.",
      "I've been editing video for more than 6 years, starting on a phone. In 2025 I started taking my craft seriously, and I'm currently taking editing commissions.",
    ],
    skillsTitle: "Skills",
    skillsBody: [
      "I use Adobe Premiere Pro, Adobe After Effects, Adobe Photoshop, and FL Studio (for SFX).",
      "I'm not currently open to commissions for long videos (10min+) with complex graphics.",
      "My portfolio --> https://t.me/arfi_edit",
    ],
    contactsTitle: "Contact",
    contactsBody: "If you want to work together, get in touch!",
    contactsLabel: "Contact",
    telegramLabel: "Telegram",
    emailLabel: "Email",
    discordLabel: "Discord",
    footer: "© Arfi",
    htmlLang: "en",
  },
};

const storageKey = "arfi-lang";

function getLang() {
  const saved = localStorage.getItem(storageKey);
  if (saved === "ru" || saved === "en") return saved;
  return "ru";
}

function applyLang(lang) {
  const copy = translations[lang];
  document.documentElement.lang = copy.htmlLang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (copy[key]) el.textContent = copy[key];
  });

  document.querySelectorAll("[data-i18n-paras]").forEach((el) => {
    const key = el.getAttribute("data-i18n-paras");
    const paras = copy[key];
    if (!Array.isArray(paras)) return;
    el.replaceChildren(
      ...paras.map((text) => {
        const p = document.createElement("p");
        p.textContent = text;
        return p;
      })
    );
  });

  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.getAttribute("data-i18n-attr")
      .split(",")
      .forEach((pair) => {
        const [attr, key] = pair.split(":").map((part) => part.trim());
        if (attr && copy[key]) el.setAttribute(attr, copy[key]);
      });
  });

  const toggle = document.getElementById("lang-toggle");
  toggle.querySelectorAll("[data-lang]").forEach((el) => {
    el.classList.toggle("is-active", el.getAttribute("data-lang") === lang);
  });
  toggle.setAttribute("aria-label", lang === "en" ? "Language: English" : "Язык: русский");
  localStorage.setItem(storageKey, lang);
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  const next = getLang() === "ru" ? "en" : "ru";
  applyLang(next);
});

applyLang(getLang());
