import pyperclip

# files = [
#     "src/components/Home.js",
#     "src/App.css",
#     "src/components/BannersNearMe.js",
#     "src/components/TopMenu.js",
# ]

files = [
    "src/components/Map.js",
    "src/components/LocationMarker.js",
    "src/components/BannerMarkers.js",
    "src/components/Mission.js",
    "src/components/MissionStepMarker.js",
    "src/components/YellowArrow.js",
]

output = "I have the following code:\n"

for file in files:
    with open("../" + file, "r") as f:
        output += str(file) + ":\n"
        output += "```\n"
        output += f.read() + "\n"
        output += "```\n\n"

output += "Do not use comments in any generated code. Always provide the full file when generating code, so I can copy-paste the full file into my editor.\n\n"
print(output)
pyperclip.copy(output)
