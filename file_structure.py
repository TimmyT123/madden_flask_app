import os

def print_folder_structure(root_path, indent=""):
    for item in sorted(os.listdir(root_path)):
        path = os.path.join(root_path, item)
        print(indent + "|-- " + item)
        if os.path.isdir(path):
            print_folder_structure(path, indent + "    ")

uploads_dir = "uploads"  # change if your path is different
print_folder_structure(uploads_dir)
