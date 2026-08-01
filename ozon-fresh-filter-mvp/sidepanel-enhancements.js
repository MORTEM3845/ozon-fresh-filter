(() => {
    "use strict";

    const productList = document.getElementById("productList");
    const sortMode = document.getElementById("sortMode");

    if (!productList || !sortMode)
        return;

    if (![...sortMode.options].some(x => x.value === "gramsPerRub")) {
        const option = document.createElement("option");
        option.value = "gramsPerRub";
        option.textContent = "По граммам за ₽";
        sortMode.insertBefore(option, sortMode.options[1] || null);
    }

    function parseNumber(value) {
        const match = String(value || "").replace(/\u00a0/g, " ").match(/\d+(?:[.,]\d+)?/);
        return match ? Number(match[0].replace(",", ".")) : null;
    }

    function parseWeightGrams(title) {
        const text = String(title || "").toLocaleLowerCase("ru-RU");
        const multiplied = text.match(/(\d+)\s*[xх×]\s*(\d+(?:[.,]\d+)?)\s*(?:г|гр)(?![а-яёa-z])/i);

        if (multiplied)
            return Math.round(Number(multiplied[1]) * parseNumber(multiplied[2]));

        const kgMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*кг(?![а-яёa-z])/giu)];

        if (kgMatches.length)
            return Math.round(parseNumber(kgMatches.at(-1)[1]) * 1000);

        const gramMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм(?:а|ов)?)(?![а-яёa-z])/giu)];
        return gramMatches.length ? Math.round(parseNumber(gramMatches.at(-1)[1])) : null;
    }

    function enhanceCard(card) {
        const title = card.querySelector(".product-title")?.textContent || "";
        const price = parseNumber(card.querySelector(".price")?.textContent);
        const weightGrams = parseWeightGrams(title);
        const gramsPerRub = weightGrams && price ? weightGrams / price : null;

        card.dataset.gramsPerRub = gramsPerRub ? String(gramsPerRub) : "";

        let metrics = card.querySelector(":scope .value-metrics");

        if (!weightGrams || !gramsPerRub) {
            metrics?.remove();
            return;
        }

        if (!metrics) {
            metrics = document.createElement("div");
            metrics.className = "value-metrics";
            const nutrition = card.querySelector(":scope .nutrition");
            const meta = card.querySelector(":scope .product-meta");
            (nutrition || meta)?.insertAdjacentElement("afterend", metrics);
        }

        if (!metrics)
            return;

        const weightText = `${weightGrams.toLocaleString("ru-RU")} г`;
        const ratioText = `${gramsPerRub.toFixed(2)} г/₽`;
        let weight = metrics.querySelector(":scope > .weight-item");
        let ratio = metrics.querySelector(":scope > .grams-per-ruble");

        if (!weight) {
            weight = document.createElement("span");
            weight.className = "weight-item";
            weight.title = "Вес товара из названия";
            metrics.appendChild(weight);
        }

        if (!ratio) {
            ratio = document.createElement("span");
            ratio.className = "grams-per-ruble";
            metrics.appendChild(ratio);
        }

        weight.textContent = weightText;
        ratio.textContent = ratioText;
    }

    function colorize(cards) {
        const values = cards.map(card => Number(card.dataset.gramsPerRub)).filter(x => Number.isFinite(x) && x > 0);

        if (!values.length)
            return;

        const min = Math.min(...values);
        const max = Math.max(...values);

        for (const card of cards) {
            const value = Number(card.dataset.gramsPerRub);
            const badge = card.querySelector(":scope .grams-per-ruble");

            if (!badge || !Number.isFinite(value) || value <= 0)
                continue;

            const position = max > min ? (value - min) / (max - min) : 1;
            const hue = Math.round(position * 120);
            const label = position >= .75 ? "очень выгодно" : position >= .4 ? "средне" : "не очень выгодно";
            badge.style.background = `hsl(${hue} 68% 36%)`;
            badge.title = `${value.toFixed(2)} грамма за 1 ₽ — ${label} относительно показанных товаров`;
        }
    }

    function sortCards(cards) {
        if (sortMode.value !== "gramsPerRub")
            return;

        const sorted = [...cards].sort((a, b) => (Number(b.dataset.gramsPerRub) || -1) - (Number(a.dataset.gramsPerRub) || -1));

        for (const card of sorted)
            productList.appendChild(card);
    }

    let scheduled = false;

    function refresh() {
        scheduled = false;
        const cards = [...productList.querySelectorAll(":scope > .product")];

        for (const card of cards)
            enhanceCard(card);

        colorize(cards);
        sortCards(cards);
    }

    function scheduleRefresh() {
        if (scheduled)
            return;

        scheduled = true;
        requestAnimationFrame(refresh);
    }

    new MutationObserver(scheduleRefresh).observe(productList, { childList: true, subtree: true, characterData: true });
    sortMode.addEventListener("change", () => setTimeout(refresh));
    scheduleRefresh();
})();
