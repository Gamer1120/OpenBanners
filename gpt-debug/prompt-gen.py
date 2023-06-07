import pyperclip

files = ["src/components/BannerMarkers.js", "src/components/Map.js", "src/components/Mission.js", "src/components/MissionStepMarker.js", "src/App.css"]

output = "I have the following code:\n"

for file in files:
    with open("../" + file, 'r') as f:
        output += str(file) + ":\n"
        output += "```\n"
        output += f.read() + "\n"
        output += "```\n\n"

output += "Please do not use comments in code. Please do not leave out code fragments with {...}.\n\n"
print(output)
pyperclip.copy(output)