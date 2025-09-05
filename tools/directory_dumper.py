#!/usr/bin/env python3
import os
import argparse
import sys
import json
import time
from datetime import datetime

# Overall purpose:
# This script scans a specified root directory, identifies its structure and
# source code files based on a configurable exclusion list, and then dumps
# all this information into a single timestamped output file.
# The output file includes the full path of the scanned directory, the dump
# date/time, a relative directory tree, and the content of each identified
# source code file, clearly demarcated.

# --- Configuration ---
# Define which file extensions should be treated as source code
SOURCE_CODE_EXTENSIONS = (
    '.py', '.c', '.h', '.cpp', '.hpp', '.js', '.ts', '.cs', '.go', '.rs', '.java',
    '.html', '.css', '.scss', '.sh', '.rb', '.php', '.md', '.txt'
)

def load_config(config_path):
    """
    Loads the exclusion configuration from a JSON file.

    Args:
        config_path (str): The path to the config.json file.

    Returns:
        dict: A dictionary with the loaded configuration. Returns a default
              empty configuration if the file doesn't exist or is invalid.
    """
    default_config = {
        "skip_files": [],
        "skip_extensions": [],
        "skip_directories": []
    }

    if not config_path or not os.path.exists(config_path):
        if config_path:
             print(f"Warning: Config file not found at '{config_path}'. Using defaults.", file=sys.stderr)
        return default_config

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            user_config = json.load(f)
            # Merge user config with defaults to ensure all keys exist
            default_config.update(user_config)
            print(f"Successfully loaded configuration from {config_path}")
            return default_config
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error: Could not read or parse config file '{config_path}'. {e}", file=sys.stderr)
        print("Continuing with no exclusions.", file=sys.stderr)
        # Reset to default if file is corrupt
        default_config.update({key: [] for key in default_config})
        return default_config

def find_files_and_dirs(root_dir, config):
    """
    Walks through the directory tree, applying exclusions from the config.

    Args:
        root_dir (str): The path to the directory to start traversal from.
        config (dict): Configuration dictionary for exclusions.

    Returns:
        tuple: A tuple containing two lists:
               - A sorted list of all relative file and directory paths.
               - A sorted list of full paths to all source code files to be dumped.
    """
    structure_paths = []
    source_file_paths = []

    # Use sets for efficient lookups
    skip_files_set = set(config.get('skip_files', []))
    skip_extensions_set = set(config.get('skip_extensions', []))
    skip_directories_set = set(config.get('skip_directories', []))

    for dirpath, dirnames, filenames in os.walk(root_dir, topdown=True):
        # --- Directory Exclusion ---
        # Exclude specified directories by modifying dirnames in-place.
        # os.walk will not descend into these directories.
        dirnames[:] = [d for d d in dirnames if d not in skip_directories_set]

        # Combine dirs and files for the structure list
        items_in_dir = dirnames + filenames
        for item_name in items_in_dir:
            # --- File and Extension Exclusion for Structure list ---
            if item_name in skip_files_set:
                continue

            _, ext = os.path.splitext(item_name)
            if ext in skip_extensions_set:
                continue

            full_path = os.path.join(dirpath, item_name)
            relative_path = os.path.relpath(full_path, root_dir)
            # On Windows, a single file in root_dir results in '.', which we can skip
            if relative_path != '.':
                structure_paths.append(relative_path)

        # --- File Exclusion for Source Dump ---
        for filename in filenames:
            # Skip __init__.py from being dumped as source code, but it will still appear in the structure list.
            if filename == "__init__.py":
                continue
            if filename in skip_files_set:
                continue

            _, ext = os.path.splitext(filename)
            if ext in skip_extensions_set:
                continue

            if filename.endswith(SOURCE_CODE_EXTENSIONS):
                full_path = os.path.join(dirpath, filename)
                source_file_paths.append(full_path)

    structure_paths.sort()
    source_file_paths.sort()

    return structure_paths, source_file_paths

def dump_to_single_file(output_filepath, root_dir, structure_paths, source_file_paths):
    """
    Writes the directory information and source code to a single output file.

    Args:
        output_filepath (str): The path to the output file.
        root_dir (str): The root directory scanned.
        structure_paths (list): Sorted list of relative file/directory paths for the structure.
        source_file_paths (list): Sorted list of full paths to source files to dump.
    """
    print(f"Writing all output to {output_filepath}...")
    try:
        with open(output_filepath, 'w', encoding='utf-8') as f:
            # 1) Full path to the dumped directory
            f.write(f"Dumped Directory: {os.path.abspath(root_dir)}\n")

            # 2) YYYY-MM-DD HH:ii:ss
            current_datetime = datetime.now()
            f.write(f"Dump Date/Time: {current_datetime.strftime('%Y-%m-%d %H:%M:%S')}\n\n")

            # 3) The full directory tree, relative to the dumped directory.
            f.write("---- directory structure ----\n")
            if not structure_paths:
                f.write("(No files or directories found after applying exclusions for structure.)\n")
            for path in structure_paths:
                # Ensure path separator consistency
                normalized_path = os.path.normpath(path).replace(os.path.sep, '/')
                f.write(f"{normalized_path}\n")
            f.write("\n") # Blank line for separation

            # 4) Each file in the tree
            if not source_file_paths:
                f.write("---- No source files found to dump after applying exclusions ----\n\n")
            else:
                for full_path in source_file_paths:
                    relative_path = os.path.relpath(full_path, root_dir)
                    header_path = relative_path.replace(os.path.sep, '/')

                    f.write(f"---- Start of file {header_path} ----\n")
                    try:
                        with open(full_path, 'r', encoding='utf-8', errors='ignore') as src_file:
                            f.write(src_file.read())
                        f.write("\n") # Ensure content ends with a newline for consistent formatting.
                    except IOError as e:
                        f.write(f"[Could not read file: {e}]\n")
                    f.write(f"---- End of file {header_path} ----\n\n") # Two newlines for separation after the block
        print(f"Successfully created {output_filepath}")
    except IOError as e:
        print(f"Error: Could not write to output file '{output_filepath}'. {e}", file=sys.stderr)
        sys.exit(1)

def main():
    """Main function to parse arguments and orchestrate the process."""
    parser = argparse.ArgumentParser(
        description="Scans a root directory, lists its structure, and dumps source code into a single, timestamped file.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        '--root-dir',
        required=True,
        help="The root directory to start scanning from."
    )
    parser.add_argument(
        '--config-file',
        default=None,
        help="Path to a JSON configuration file for skipping files/directories."
    )
    args = parser.parse_args()

    if not os.path.isdir(args.root_dir):
        print(f"Error: The specified root directory does not exist: {args.root_dir}", file=sys.stderr)
        sys.exit(1)

    # --- Main Execution ---
    # 1. Load configuration
    config = load_config(args.config_file)

    # 2. Find all paths based on config
    structure_paths, source_files_to_dump = find_files_and_dirs(args.root_dir, config)

    # 3. Generate output filename based on requirements
    # Get the last component of the root directory path
    dir_name = os.path.basename(os.path.abspath(args.root_dir))
    timestamp = int(time.time()) # Unix timestamp
    output_filename = f"ddump-{dir_name}-{timestamp}.txt"

    # 4. Write all content to a single file
    dump_to_single_file(output_filename, args.root_dir, structure_paths, source_files_to_dump)

    print("\nScript finished successfully.")

if __name__ == "__main__":
    main()