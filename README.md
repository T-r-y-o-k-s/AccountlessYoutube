# Accountless Youtube Extension
#### Tested to work on: Firefox.

Accountless Youtube allows you to subscribe to channels without a 
google account, the subscription list is saved locally in extension storage. <br>
The feed will show up in the subscriptions tab in chronological order, 
and the subscribed channels will show up on the side bar/pad/guide on the left. <br>
The subscribe button is automatically replaced so you can
just click Subscribe like you normally would to add a channel.

The extension scrapes the video data from youtube. It will
not take into consideration older videos due to youtube's annoying api, 
however that is usually not necessary anyways. <br>
The extension replaces the usual feed, side bar, and button with 
its own versions that are easier to work with, however the replacements
are not perfect so this is why you might notice a different look/behaviour.

You can also import and export the list of subscriptions to a file.

#### Autoloading
As this extension is not available on [AMO](https://addons.mozilla.org/), you'll need to load it as a temporary extension each time you restart the browser. <br>
I've found it quite helpful to make Firefox automatically load this addon as described in [this guide](https://tsaost.github.io/autoload-temporary-addon/). <br>
Be sure to follow both [PR#3](https://github.com/tsaost/autoload-temporary-addon/pull/3/files) and [PR#7](https://github.com/tsaost/autoload-temporary-addon/pull/7/files) to make that hack work on newer versions of Firefox.
