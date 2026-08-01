(() => {
    "use strict";

    const storageKey = "ozonFreshFilterRules";
    const categoryBoost = 150;
    let preferredCategories = new Set();

    function categoryName(product) {
        return product.category || "Другое";
    }

    function loadPreferredCategories(rules) {
        preferredCategories = new Set(rules.preferredCategories || []);

        for (const category of excludedCategories)
            preferredCategories.delete(category);
    }

    const originalGetRules = getRules;
    getRules = function() {
        return {
            ...originalGetRules(),
            preferredCategories: [...preferredCategories]
        };
    };

    const originalLoadSettings = loadSettings;
    loadSettings = async function() {
        await originalLoadSettings();
        const result = await chrome.storage.local.get(storageKey);
        loadPreferredCategories(result[storageKey] || {});
    };

    renderCategoryFilter = function(products) {
        for (const category of excludedCategories)
            preferredCategories.delete(category);

        const counts = new Map();

        for (const product of products) {
            const category = categoryName(product);
            counts.set(category, (counts.get(category) || 0) + 1);
        }

        const categories = [...new Set([...counts.keys(), ...preferredCategories, ...excludedCategories])]
            .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b, "ru"));

        elements.categoryChips.replaceChildren();

        if (!categories.length) {
            const placeholder = document.createElement("span");
            placeholder.className = "category-placeholder";
            placeholder.textContent = "Появятся после сбора товаров";
            elements.categoryChips.appendChild(placeholder);
            return;
        }

        for (const category of categories) {
            const button = document.createElement("button");
            const preferred = preferredCategories.has(category);
            const excluded = excludedCategories.has(category);
            const state = excluded ? "excluded" : preferred ? "preferred" : "neutral";

            button.type = "button";
            button.className = `category-chip ${state}`;
            button.textContent = `${category} ${counts.get(category) || 0}`;
            button.title = state === "neutral"
                ? "Обычная категория. Нажми, чтобы поднять товары выше"
                : state === "preferred"
                    ? "Категория в приоритете. Нажми, чтобы исключить"
                    : "Категория исключена. Нажми, чтобы вернуть в обычное состояние";

            button.addEventListener("click", () => {
                if (preferredCategories.has(category)) {
                    preferredCategories.delete(category);
                    excludedCategories.add(category);
                } else if (excludedCategories.has(category)) {
                    excludedCategories.delete(category);
                } else {
                    preferredCategories.add(category);
                }

                saveAndApplyRules().catch(error => setStatus(error.message, true));
            });

            elements.categoryChips.appendChild(button);
        }
    };

    const originalGetVisibleProducts = getVisibleProducts;
    getVisibleProducts = function() {
        const products = originalGetVisibleProducts();

        if (elements.sortMode.value !== "benefit")
            return products;

        return products.sort((a, b) => {
            const aScore = a.score + (preferredCategories.has(categoryName(a)) ? categoryBoost : 0);
            const bScore = b.score + (preferredCategories.has(categoryName(b)) ? categoryBoost : 0);
            return Number(b.suitable) - Number(a.suitable) || bScore - aScore || a.price - b.price;
        });
    };

    chrome.storage.local.get(storageKey).then(result => {
        loadPreferredCategories(result[storageKey] || {});
        render();
    }).catch(error => setStatus(error.message, true));
})();
