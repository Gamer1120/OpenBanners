import pyperclip

files = [
    # "src/App.css",
    # "src/App.js",
    # "src/index.js",
    # "src/components/Home.js",
    # "src/components/TopMenu.js",
    # "src/components/BannersNearMe.js",
    "src/components/BrowsingPage.js",
    "src/components/BrowsingHeader.js",
    "src/components/BannerCard.js",
    "src/components/SortingButtons.js",
    # "src/components/Map.js",
    # "src/components/BannerMarkers.js",
    "src/components/PlacesList.js",
    # "src/components/SearchResults.js",
    # "src/components/BannerDetailsPage.js",
    # "src/components/BannerDetailsCard.js",
    # "src/components/BannerInfo.js",
]

# files = [
#     "src/components/Map.js",
#     "src/components/LocationMarker.js",
#     "src/components/BannerMarkers.js",
#     "src/components/Mission.js",
# ]

output = "I have the following code:\n"

for file in files:
    with open("../" + file, "r") as f:
        output += str(file) + ":\n"
        output += "```\n"
        output += f.read() + "\n"
        output += "```\n\n"

output += "Do not use comments in any generated code. Please do not leave out code fragments with {...}.\n\n"
print(output)
pyperclip.copy(output)
