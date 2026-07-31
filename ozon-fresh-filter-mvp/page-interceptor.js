(() => {
    if (window.__ozonFreshInterceptorInstalled)
        return;

    window.__ozonFreshInterceptorInstalled = true;

    const ENTRYPOINT_PART = "/api/entrypoint-api.bx/page/json/v2";
    const EVENT_TYPE = "OZON_FRESH_PAGE_EVENT";
    const COMMAND_TYPE = "OZON_FRESH_PAGE_COMMAND";
    const MAX_BODY_LENGTH = 8_000_000;

    const originalFetch = window.fetch.bind(window);
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    let chainController = null;
    let chainStopRequested = false;

    function absoluteUrl(value) {
        try {
            const raw = typeof value === "string" ? value : value?.url;
            return new URL(raw, location.href).href;
        } catch {
            return "";
        }
    }

    function isEntrypointUrl(url) {
        return Boolean(url) && url.includes(ENTRYPOINT_PART);
    }

    function post(event) {
        window.postMessage({
            type: EVENT_TYPE,
            event: {
                timestamp: Date.now(),
                pageUrl: location.href,
                ...event
            }
        }, "*");
    }

    async function readResponse(response, url, source, kind = "response") {
        try {
            const clone = response.clone();
            const text = await clone.text();

            post({
                kind,
                source,
                url,
                status: response.status,
                ok: response.ok,
                body: text.slice(0, MAX_BODY_LENGTH),
                bodyLength: text.length,
                truncated: text.length > MAX_BODY_LENGTH
            });
        } catch (error) {
            post({
                kind: "error",
                source,
                url,
                message: error?.message || String(error)
            });
        }
    }

    window.fetch = function (...args) {
        const url = absoluteUrl(args[0]);

        if (!isEntrypointUrl(url))
            return originalFetch(...args);

        post({
            kind: "request",
            source: "fetch",
            url,
            method: args[1]?.method || "GET"
        });

        const promise = originalFetch(...args);

        promise.then(response => {
            readResponse(response, url, "fetch");
        }).catch(error => {
            post({
                kind: "error",
                source: "fetch",
                url,
                message: error?.message || String(error)
            });
        });

        return promise;
    };

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ozonFreshMethod = method;
        this.__ozonFreshUrl = absoluteUrl(url);

        return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        const url = this.__ozonFreshUrl;

        if (isEntrypointUrl(url)) {
            post({
                kind: "request",
                source: "xhr",
                url,
                method: this.__ozonFreshMethod || "GET"
            });

            this.addEventListener("loadend", () => {
                let body = "";

                try {
                    if (this.responseType === "" || this.responseType === "text")
                        body = this.responseText || "";
                    else if (this.responseType === "json")
                        body = JSON.stringify(this.response);
                } catch {
                    body = "";
                }

                post({
                    kind: "response",
                    source: "xhr",
                    url,
                    status: this.status,
                    ok: this.status >= 200 && this.status < 300,
                    body: body.slice(0, MAX_BODY_LENGTH),
                    bodyLength: body.length,
                    truncated: body.length > MAX_BODY_LENGTH
                });
            }, { once: true });
        }

        return originalXhrSend.apply(this, args);
    };

    function reportPerformanceEntry(entry, source = "performance") {
        const url = absoluteUrl(entry?.name);

        if (!isEntrypointUrl(url))
            return;

        post({
            kind: "resource",
            source,
            url,
            duration: Math.round(entry.duration || 0),
            transferSize: entry.transferSize || 0,
            initiatorType: entry.initiatorType || ""
        });
    }

    try {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries())
                reportPerformanceEntry(entry);
        });

        observer.observe({ type: "resource", buffered: true });
    } catch (error) {
        post({
            kind: "error",
            source: "performance",
            message: error?.message || String(error)
        });
    }

    function snapshotPerformance() {
        for (const entry of performance.getEntriesByType("resource"))
            reportPerformanceEntry(entry, "performance-snapshot");
    }

    function findNextPage(node, depth = 0) {
        if (!node || depth > 8)
            return null;

        if (Array.isArray(node)) {
            for (const item of node) {
                const found = findNextPage(item, depth + 1);

                if (found)
                    return found;
            }

            return null;
        }

        if (typeof node !== "object")
            return null;

        for (const [key, value] of Object.entries(node)) {
            if ((key === "nextPage" || key === "next_page") &&
                typeof value === "string" &&
                value.startsWith("/")) {
                return value;
            }
        }

        for (const value of Object.values(node)) {
            const found = findNextPage(value, depth + 1);

            if (found)
                return found;
        }

        return null;
    }

    async function fetchCapturedUrl(url) {
        try {
            const response = await originalFetch(url, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: {
                    accept: "application/json"
                }
            });

            await readResponse(response, url, "captured-url", "captured-response");
        } catch (error) {
            post({
                kind: "error",
                source: "captured-url",
                url,
                message: error?.message || String(error)
            });
        }
    }


    async function fetchProductDetails(command) {
        const requestId = String(command.requestId || "");
        const productId = String(command.productId || "");

        try {
            const productUrl = new URL(command.url, location.origin);
            productUrl.searchParams.delete("at");
            productUrl.hash = "";

            const endpoint = new URL(ENTRYPOINT_PART, location.origin);
            endpoint.searchParams.set("url", `${productUrl.pathname}${productUrl.search}`);

            const response = await originalFetch(endpoint.href, {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: {
                    accept: "application/json"
                }
            });

            const text = await response.text();

            post({
                kind: "product-details-response",
                source: "product-details",
                requestId,
                productId,
                url: endpoint.href,
                status: response.status,
                ok: response.ok,
                body: text.slice(0, MAX_BODY_LENGTH),
                bodyLength: text.length,
                truncated: text.length > MAX_BODY_LENGTH
            });
        } catch (error) {
            post({
                kind: "product-details-error",
                source: "product-details",
                requestId,
                productId,
                message: error?.message || String(error)
            });
        }
    }

    async function technicalScroll(waitMs) {
        const startY = window.scrollY;
        const oldBehavior = document.documentElement.style.scrollBehavior;

        document.documentElement.style.scrollBehavior = "auto";

        post({
            kind: "technical-scroll-started",
            source: "command"
        });

        window.scrollTo(0, document.documentElement.scrollHeight);

        await new Promise(resolve => setTimeout(resolve, waitMs));

        snapshotPerformance();

        window.scrollTo(0, startY);
        document.documentElement.style.scrollBehavior = oldBehavior;

        post({
            kind: "technical-scroll-finished",
            source: "command"
        });
    }

    async function startChain(firstPageUrl, limit) {
        chainStopRequested = false;
        chainController?.abort();
        chainController = new AbortController();

        let pageUrl = firstPageUrl;
        const visited = new Set();

        post({
            kind: "chain-started",
            source: "chain"
        });

        for (let page = 1; page <= limit && pageUrl; page++) {
            if (chainStopRequested)
                break;

            if (visited.has(pageUrl)) {
                post({
                    kind: "chain-error",
                    source: "chain",
                    page,
                    message: "Ozon вернул повторяющийся nextPage"
                });

                break;
            }

            visited.add(pageUrl);

            const endpoint = new URL(ENTRYPOINT_PART, location.origin);
            endpoint.searchParams.set("url", pageUrl);

            const startedAt = performance.now();

            try {
                const response = await originalFetch(endpoint.href, {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store",
                    headers: {
                        accept: "application/json"
                    },
                    signal: chainController.signal
                });

                const text = await response.text();

                post({
                    kind: "chain-response",
                    source: "chain",
                    url: endpoint.href,
                    innerUrl: pageUrl,
                    page,
                    status: response.status,
                    ok: response.ok,
                    duration: Math.round(performance.now() - startedAt),
                    body: text.slice(0, MAX_BODY_LENGTH),
                    bodyLength: text.length,
                    truncated: text.length > MAX_BODY_LENGTH
                });

                if (!response.ok)
                    break;

                let json;

                try {
                    json = JSON.parse(text);
                } catch {
                    break;
                }

                pageUrl = typeof json.nextPage === "string"
                    ? json.nextPage
                    : findNextPage(json);
            } catch (error) {
                if (error?.name !== "AbortError") {
                    post({
                        kind: "chain-error",
                        source: "chain",
                        page,
                        url: endpoint.href,
                        message: error?.message || String(error)
                    });
                }

                break;
            }
        }

        post({
            kind: "chain-finished",
            source: "chain",
            stopped: chainStopRequested
        });
    }

    function stopChain() {
        chainStopRequested = true;
        chainController?.abort();
    }

    window.addEventListener("message", event => {
        if (event.source !== window || event.data?.type !== COMMAND_TYPE)
            return;

        const command = event.data.command || {};

        if (command.name === "snapshot-performance") {
            snapshotPerformance();
        } else if (command.name === "technical-scroll") {
            technicalScroll(Number(command.waitMs) || 2500);
        } else if (command.name === "fetch-captured-url") {
            fetchCapturedUrl(command.url);
        } else if (command.name === "fetch-product-details") {
            fetchProductDetails(command);
        } else if (command.name === "start-chain") {
            startChain(
                command.firstPageUrl,
                Math.max(1, Math.min(200, Number(command.limit) || 50))
            );
        } else if (command.name === "stop-chain") {
            stopChain();
        }
    });

    post({
        kind: "interceptor-ready",
        source: "interceptor"
    });

    snapshotPerformance();
})();