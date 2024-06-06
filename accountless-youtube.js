class Video {
    constructor(channel, href, thumbnailImageURL, thumbnailImageHeight, thumbnailImageWidth, title, durationSecs, views, ageSecs) {
        this.channel = channel;
        this.href = href;
        this.thumbnailImageURL = thumbnailImageURL;
        this.thumbnailImageHeight = thumbnailImageHeight;
        this.thumbnailImageWidth = thumbnailImageWidth;
        this.title = title;
        this.durationSecs = durationSecs;
        this.views = views;
        this.ageSecs = ageSecs;
    }
}


var subscriptions = {};
var feedVideos = [];
var lastUpdated = new Date(0);
var lazyImgObserver = new IntersectionObserver(lazyLoad, {
    rootMargin: "100px",
    threshold: 1.0
});

console.log("Accountless-youtube content script loaded!");

// NOTE: Will scrape youtube to get the data
function getSubscriptionVideosAndIconUrl(subscription) {
    subVideos = [];
    subIconUrl = "";

    subscription = subscription.toString().trim();
    console.log("Adding videos of sub: ", subscription);
    var channelUrl = "https://www.youtube.com/@" + subscription + "/videos";
    let request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (this.readyState === 4 && this.status === 200) {
            try{
            var parser = new DOMParser();
            var documentToScrape = parser.parseFromString(request.responseText, "text/html");
            // Extract variable from scripts
            var jsonSring = Array.from(documentToScrape.getElementsByTagName("script"))
                .map(script => script.innerText.match(/ytInitialData *= *(\{[\s\S]*\})/)).filter(res => res !== null)[0][1]; /* select first regex match result, then select the second match of that regex match result to get the result of the capture group */

            var ytInitialData = JSON.parse(jsonSring);
            }catch(e){
                console.log("Failed to scrape channel!");
                console.log("Error: ", e);
            }
            
            try {
                subIconUrl = ytInitialData["header"]["pageHeaderRenderer"]["content"]["pageHeaderViewModel"]["image"]["decoratedAvatarViewModel"]["avatar"]["avatarViewModel"]["image"]["sources"].slice(-1)[0]["url"];
            } catch (e) {
                console.log("Failed to get channel icon!");
                console.log("Error: ", e);
            }

            var content = ytInitialData["contents"]["twoColumnBrowseResultsRenderer"]["tabs"]
                .find(tab => tab["tabRenderer"]["selected"])["tabRenderer"]["content"]["richGridRenderer"]["contents"];
            for (var video of content.slice(0, -1)/* the last element contains data on how to fetch extra videos */) {
                try {
                    var video = video["richItemRenderer"]["content"]["videoRenderer"];
                    var thumbnail = video["thumbnail"]["thumbnails"].slice(-2)[0];
                    var thumbnailUrl = thumbnail["url"];
                    var thumbnailWidth = thumbnail["width"];
                    var thumbnailHeight = thumbnail["height"];
                    var id = video["navigationEndpoint"]["watchEndpoint"]["videoId"];
                    var title = video["title"]["runs"].map(run => run["text"]).join();
                    var duration = fromHHMMSS(video["lengthText"]["simpleText"]);
                    var views = parseInt(video["viewCountText"]["simpleText"].replace(/\D/g, ''));
                    var age = fromHumanAge(video["publishedTimeText"]["simpleText"]);
                    subVideos.push(new Video(subscription, "/watch?v=" + id, thumbnailUrl, thumbnailHeight, thumbnailWidth, title, duration, views, age));
                } catch (e) {
                    console.log("Failed to add a video!");
                    console.log("Error: ", e);
                }
            }
        }
    };

    request.open("GET", channelUrl, false/* NOT async */);
    request.send();
    return [subVideos, subIconUrl];
}

function removeSubscriptionVideos(subscription) {
    feedVideos = feedVideos.filter((video) => video.channel !== subscription);
}



function getChannelName() {
    var handle = document.querySelector("yt-formatted-string[id=\"channel-handle\"]");
    if (handle !== null && handle !== undefined) return handle.innerText.slice(1);

    var videoChannelName = Array.from(document.querySelectorAll("yt-formatted-string.ytd-channel-name")).filter((match) => match.offsetParent !== null)[0];
    if (videoChannelName !== null && videoChannelName !== undefined) {
        var link = videoChannelName;
        while (link.getElementsByTagName("a").length === 0) {
            link = link.parentElement;
        }
        return link.getElementsByTagName("a")[0].href.split('/').slice(-1)[0].slice(1);
    }

    return null;
}

function sortFeed() {
    feedVideos = feedVideos.sort((a, b) => { if (a.ageSecs < b.ageSecs) { return -1; } else if (a.ageSecs > b.ageSecs) { return 1; } else { return 0; } });
}

function lazyLoad(elements) {
    elements.forEach(entry => {
        if (entry.intersectionRatio > 0) {
            var image = entry.target;
            // set the src attribute to trigger a load
            image.src = image.dataset.src;

            // stop observing this element. Our work here is done!
            lazyImgObserver.unobserve(image);
        };
    });
};



function localStorageExists() {
    try {
        // Try to access local storage, even if the key doesn't exist, it wont't throw an error
        // So we can use try .. catch to detect if browser.storage.local is initialized
        browser.storage.local.get("this string can be anything");
        return true;
    } catch (e) {
        return false;
    }
}

async function readStorageData() {
    if (!localStorageExists()) return false;
    var subscriptionsRead = (await browser.storage.local.get("subscriptions"))["subscriptions"];
    if (subscriptionsRead !== undefined && subscriptionsRead !== null) {
        subscriptions = subscriptionsRead;
    }

    var feedVideosRead = (await browser.storage.local.get("cachedVideos"))["cachedVideos"];
    if (feedVideosRead !== undefined && feedVideosRead !== null) {
        feedVideos = feedVideosRead;
    }

    var lastUpdatedRead = (await browser.storage.local.get("lastUpdated"))["lastUpdated"];
    if (lastUpdatedRead !== undefined && lastUpdatedRead !== null) {
        lastUpdated = new Date(Date.parse(lastUpdatedRead));
    }

    return true;
}

async function writeStorageData() {
    if (!localStorageExists()) return false;
    await browser.storage.local.set({ "subscriptions": subscriptions });
    await browser.storage.local.set({ "lastUpdated": lastUpdated.toJSON() });
    await browser.storage.local.set({ "cachedVideos": feedVideos });
    return true;
}

async function addStorageListener() {
    if (!localStorageExists()) return false;
    await browser.storage.onChanged.addListener(async () => {
        // Make sure we are in sync
        await ensure(readStorageData, () => { return sleep(1_000); })
        hijackSubscribeButton();
        await Promise.all([
            ensure(hijackFeed, () => { return sleep(1_000) }),
            ensure(hijackPanelSubs, () => { return sleep(1_000); }),

        ])
    });
    return true;
}


window.addEventListener("pageshow", async () => {
    await ensure(readStorageData, () => { return sleep(500); });
    console.log("Using last updated date: ", lastUpdated);

    if ((new Date() - lastUpdated) / 1000 / 60 > 10) { // If more than 10 minutes since last update
        console.log("Updating feed!");
        feedVideos = [];
        try{
            document.querySelector("ytd-browse[page-subtype=\"subscriptions\"]:not([hidden])").innerText = "Updating feed, please wait ...";
        }catch(e){
            // It's not important to display update message
        }

        for (var subscription in subscriptions) {
            var res = getSubscriptionVideosAndIconUrl(subscription);
            feedVideos = feedVideos.concat(res[0]);
            sortFeed();
            subscriptions[subscription] = res[1]; // Update channel icon
            await sleep(Math.random()*100);
        }

        lastUpdated = new Date();
        await ensure(writeStorageData, () => { return sleep(500); });
    }

    // Try to inject at a periodic interval, stopping once we have injected
    await Promise.all([
        ensure(hijackFeed, () => { return sleep(3_000); }),
        ensure(hijackPanelSubs, () => { return sleep(5_000); }),
        ensure(hijackSubscribeButton, () => { return sleep(2_000); })
    ]);
}, false);

// Inject on dom change, to make the extension more responsive as those could come before the periodic interval/pageshow
ensure(readStorageData, () => { return sleep(1_000); }).then(() => {
    return Promise.all([
        ensure(hijackFeed, waitForDomChange),
        ensure(hijackPanelSubs, waitForDomChange),
        ensure(hijackSubscribeButton, waitForDomChange)]);
});

// Subscribe buttons may show up when searching
window.setInterval(hijackSubscribeButton, 5_000);

ensure(addStorageListener, () => { return sleep(1_000); });


/////////////////////////////////////////////////////////////////////
// Formatting functions

// Takes human dates like: 10 years, or 2.5 minutes
// And returns: that date in seconds
function fromHumanAge(string) {
    const unitMap = {
        "second": 1,
        "seconds": 1,
        "minute": 60,
        "minutes": 60,
        "hour": 60 * 60,
        "hours": 60 * 60,
        "day": 24 * 60 * 60,
        "days": 24 * 60 * 60,
        "week": 7 * 24 * 60 * 60,
        "weeks": 7 * 24 * 60 * 60,
        "month": 30 * 24 * 60 * 60,
        "months": 30 * 24 * 60 * 60,
        "year": 12 * 30 * 24 * 60 * 60,
        "years": 12 * 30 * 24 * 60 * 60,
        "decade": 10 * 12 * 30 * 24 * 60 * 60,
        "decades": 10 * 12 * 30 * 24 * 60 * 60,
    };

    let splits = /(\d*.?\d+) +([^ ]+)/.exec(string).splice(1);
    return parseFloat(splits[0]) * unitMap[splits[1]];
}

function toHumanAge(secs) {
    var decades = Math.round((secs / (10 * 12 * 30 * 24 * 60 * 60)) % (10 * 12 * 30 * 24 * 60 * 60) * 10) / 10;
    if (decades > 1) {
        return decades + " decades";
    } else if (decades == 1) {
        return decades + " decade";
    }

    var years = Math.round(((secs / (12 * 30 * 24 * 60 * 60)) % (12 * 30 * 24 * 60 * 60)) * 10) / 10;
    if (years > 1) {
        return years + " years";
    } else if (years == 1) {
        return years + " year";
    }

    var months = Math.round(((secs / (30 * 24 * 60 * 60)) % (30 * 24 * 60 * 60)) * 10) / 10;
    if (months > 1) {
        return months + " months";
    } else if (months == 1) {
        return months + " month";
    }

    var days = Math.round(((secs / (24 * 60 * 60)) % (24 * 60 * 60)) * 10) / 10;
    if (days > 1) {
        return days + " days";
    } else if (days == 1) {
        return days + " day";
    }

    var hours = Math.round(((secs / (60 * 60)) % (60 * 60)) * 10) / 10;
    if (hours > 1) {
        return hours + " hours";
    } else if (hours == 1) {
        return hours + " hour";
    }

    var minutes = Math.round(((secs / 60) % 60) * 10) / 10;
    if (minutes > 1) {
        return minutes + " minutes";
    } else if (minutes == 1) {
        return minutes + " minute";
    }

    var seconds = Math.round((secs % 60) * 10) / 10;
    if (seconds > 1) {
        return seconds + " seconds";
    } else if (seconds == 1) {
        return seconds + " second";
    } else {
        return seconds + " seconds";
    }
}

function toHHMMSS(secs) {
    var hours = Math.floor(secs / (60 * 60));
    var minutes = Math.floor(secs / 60) % 60;
    var seconds = secs % 60;

    return [hours, minutes, seconds]
        .map(value => value < 10 ? ("0" + value) : ("" + value))
        .filter((value, index) => value !== "00" || index === 1 || index == 2) // Remove 0's, but keep minutes and seconds
        .join(":");
}

function fromHHMMSS(string) {
    var vals = string.split(":").map(val => parseInt(val)).map(val => { if (val === null) return 0; else return val; });
    var amount = 0;
    var ind = 0;
    for (var formatElement of vals.reverse()) {
        amount += Math.pow(60, ind) * formatElement;
        ind++;
    }
    return amount;
}

function formatViews(views) {
    if (views < 1e3) {
        return views.toString();
    } else if (views < 1e6) {
        return (Math.floor(views / 1e2) / 10).toString() + "K";
    } else if (views < 1e9) {
        return (Math.floor(views / 1e5) / 10).toString() + "M";
    } else if (views < 1e12) {
        return (Math.floor(views / 1e8) / 10).toString() + "B";
    } else {
        // Give up, i guess?
        return views.toString();
    }
}



/////////////////////////////////////////////////////////////////////



/////////////////////////////////////////////////////////////////////
// Injection functions


function injectVideo(feed, videoHref, channelHref, iconImageSrc, thumbnailImageSrc, thumbnailImageHeight, thumbnailImageWidth, durationText, title, channel, stats) {
    var injectedVideo = document.createElement("div");
    injectedVideo.classList.add("injected-yt", "feed-video");
    feed.appendChild(injectedVideo);

    var injectedThumbnail = document.createElement("div");
    injectedThumbnail.classList.add("injected-yt", "feed-video-thumbnail");
    injectedVideo.appendChild(injectedThumbnail);

    { // Add link, image and duration to thumbnail
        var thumbnailLink = document.createElement("a");
        injectedThumbnail.appendChild(thumbnailLink);
        thumbnailLink.href = videoHref;

        var thumbnailImage = document.createElement("img");
        thumbnailImage.classList.add("injected-yt", "feed-video-thumbnail", "lazy");
        thumbnailImage.width = thumbnailImageWidth;
        thumbnailImage.height = thumbnailImageHeight;
        thumbnailImage.setAttribute("loading", "lazy");
        thumbnailImage.setAttribute("fetchpriority", "low");
        thumbnailLink.appendChild(thumbnailImage);
        thumbnailImage.dataset.src = thumbnailImageSrc;

        var injectedDuration = document.createElement("div");
        injectedDuration.classList.add("injected-yt", "feed-video-thumbnail-duration");
        thumbnailLink.appendChild(injectedDuration);
        injectedDuration.innerText = durationText;
    }

    var injectedMetadata = document.createElement("div");
    injectedMetadata.classList.add("injected-yt-metadata");
    injectedVideo.appendChild(injectedMetadata);

    {
        // channel image would go here along with wrapper
        var iconWrapper = document.createElement("div");
        iconWrapper.classList.add("injected-yt", "feed-video-metadata-channel-image");
        injectedMetadata.appendChild(iconWrapper);

        var iconLink = document.createElement("a");
        iconLink.href = channelHref;
        iconWrapper.appendChild(iconLink);

        var iconImage = document.createElement("img");
        iconImage.classList.add("injected-yt", "feed-video-metadata-channel-image", "lazy");
        iconImage.setAttribute("loading", "lazy");
        iconImage.setAttribute("fetchpriority", "low");
        iconLink.appendChild(iconImage);
        iconImage.dataset.src = iconImageSrc;

        var titleWrapper = document.createElement("div");
        titleWrapper.classList.add("injected-yt", "feed-video-metadata-title");
        injectedMetadata.appendChild(titleWrapper);

        var injectedTitle = document.createElement("a");
        titleWrapper.appendChild(injectedTitle);
        injectedTitle.innerText = title;
        injectedTitle.href = videoHref;

        var channelWrapper = document.createElement("div");
        channelWrapper.classList.add("injected-yt", "feed-video-metadata-channel");
        injectedMetadata.appendChild(channelWrapper);

        var injectedYtChannel = document.createElement("a");
        channelWrapper.appendChild(injectedYtChannel);
        injectedYtChannel.innerText = channel;
        injectedYtChannel.href = channelHref;

        var injectedStats = document.createElement("div");
        injectedStats.classList.add("injected-yt", "feed-video-metadata-stats");
        injectedMetadata.appendChild(injectedStats);
        injectedStats.innerText = stats;
    }

}


function injectPanelChannel(panel, channel, channelHref, iconURL) {
    var injectedChannel = document.createElement("div");
    injectedChannel.classList.add("injected-yt", "panel-channel");
    panel.appendChild(injectedChannel);

    var iconWrapper = document.createElement("div");
    iconWrapper.classList.add("injected-yt", "panel-channel-image");
    injectedChannel.appendChild(iconWrapper);

    var iconLink = document.createElement("a");
    iconWrapper.appendChild(iconLink);
    iconLink.href = channelHref;

    var iconImage = document.createElement("img");
    iconImage.classList.add("injected-yt", "panel-channel-image", "lazy");
    iconImage.setAttribute("loading", "lazy");
    iconImage.setAttribute("fetchpriority", "low");
    iconLink.appendChild(iconImage);
    iconImage.dataset.src = iconURL;

    var titleWrapper = document.createElement("div");
    titleWrapper.classList.add("injected-yt", "panel-channel-title");
    injectedChannel.appendChild(titleWrapper);

    var title = document.createElement("a");
    titleWrapper.appendChild(title);
    title.innerText = channel;
    title.href = channelHref;
}


function hijackFeed() {
    try {
        var content = document.querySelector("ytd-browse[page-subtype=\"subscriptions\"]:not([hidden])");
        if (content !== null) {
            if (content.attributes["page-subtype"].nodeValue === "subscriptions") {
                content.innerHTML = "";

                var injected_feed = document.createElement("div");
                injected_feed.classList.add("injected-yt", "feed");
                content.appendChild(injected_feed);
                for (const video of feedVideos) {
                    var sinceLastUpdateSecs = 0;
                    if (lastUpdated !== new Date(0)) {
                        sinceLastUpdateSecs = (new Date() - lastUpdated) / 1000;
                    }
                    injectVideo(injected_feed, video.href, "/@" + video.channel, subscriptions[video.channel], video.thumbnailImageURL, video.thumbnailImageHeight, video.thumbnailImageWidth, toHHMMSS(video.durationSecs), video.title, video.channel, formatViews(video.views) + " views • " + toHumanAge(video.ageSecs + sinceLastUpdateSecs) + " ago");
                }

                document.querySelectorAll('img.lazy').forEach(img => {
                    lazyImgObserver.observe(img);
                });

                return true;
            }
        }
    } catch (e) {
        console.log("Failed to hijack feed!");
        console.log("Error: ", e);
        return false;
    }

    return false;
}

async function hijackPanelSubs() {
    try {
        var panel = document.querySelector("ytd-guide-renderer[id=\"guide-renderer\"]");
        if (panel === null) return false;

        // Remove promo
        for (var promo of document.getElementsByTagName("ytd-guide-signin-promo-renderer")) {
            promo.remove();
        }

        var panelData = panel.getElementsByTagName("ytd-guide-section-renderer");
        if (panelData === null) return false;
        var panelSubs = panelData[1].querySelector("div[id=\"items\"]");
        panelSubs.innerHTML = "";
        for (var sub in subscriptions) {
            injectPanelChannel(panelSubs, sub, "/@" + sub, subscriptions[sub]);
        }

        document.querySelectorAll('img.lazy').forEach(img => {
            lazyImgObserver.observe(img);
        });

        return true;
    } catch (e) {
        console.log("Failed to hijack panel subs!");
        console.log("Error: ", e);
        return false;
    }

    return false;
}

async function hijackSubscribeButton() {
    try {
        // Find first visible subscribe button
        var theButtonRenderer = Array.from(document.querySelectorAll("div[id=\"subscribe-button\"]")).filter((match) => match.offsetParent !== null)[0];
        if (theButtonRenderer !== null && theButtonRenderer !== undefined) {
            theButtonRenderer.innerHTML = "<button style=\" border-color: transparent; background-color: rgb(232, 230, 227); border-radius: 20px; cursor: pointer; font-family: sans-serif; font-weight: 500; font-size: 15px; padding: 5px 12px 7px 12px; \"><span role=\"text\"></span></button>";
            var theButton = theButtonRenderer.getElementsByTagName("button")[0];
            var buttonTextElement = theButton.querySelector("span[role=\"text\"]");
            var theChannel = getChannelName();
            if (theChannel === null) return false;

            if (subscriptions.hasOwnProperty(theChannel)) {
                buttonTextElement.innerText = "Unsubscribe";
            } else {
                buttonTextElement.innerText = "Subscribe";
            }

            theButton.onclick = async () => {
                // Make sure we are in sync
                await ensure(readStorageData, () => { return sleep(1_000); });
                if (buttonTextElement.innerText === "Subscribe") {
                    var res = getSubscriptionVideosAndIconUrl(theChannel);
                    feedVideos = feedVideos.concat(res[0]);
                    sortFeed();
                    subscriptions[theChannel] = res[1];
                    buttonTextElement.innerText = "Unsubscribe";
                } else {
                    delete subscriptions[theChannel];
                    removeSubscriptionVideos(theChannel);
                    buttonTextElement.innerText = "Subscribe"
                }
                ensure(writeStorageData, () => { return sleep(1_000); });
            };
            return true;
        }
    } catch (e) {
        console.log("Failed to hijack subscribe button!");
        console.log("Error: ", e);
        return false;
    }

    return false;
}

/////////////////////////////////////////////////////////////////////





function sleep(amountInMs) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, amountInMs);
    });
}

async function waitForDomChange() {
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            resolve();
        });

        observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true
        });
    });
}

// Keeps executing f, until it returns true, calling waitingFunction to avoid a tight loop
// Returns immediately, letting f run in the background asynchronously
// If you want to wait for f to succeed you can simply await ensure
async function ensure(f, waitingFunction) {
    while ((await f()) === false) {
        await waitingFunction();
        await sleep(100);
    }
}
