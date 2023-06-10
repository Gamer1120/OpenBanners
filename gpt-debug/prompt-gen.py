import pyperclip

files = [
    # "src/components/Home.js",
    # "src/App.css",
    # "src/index.js",
    "src/components/BannersNearMe.js",
    "src/components/TopMenu.js",
    "src/components/BrowsingPage.js",
    "src/components/BannerCard.js",
    "src/components/LocationMarker.js",
    "src/components/Map.js",
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
