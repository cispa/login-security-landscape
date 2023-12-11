import db


def e(s):
    return (
        s.replace("_", "\\_")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def document(out):
    """Create .md Documentation of the database automatically."""
    out.write("<!-- Automatically generated Documentation -->\n")

    out.write("## Tables \n")

    type_map = {
        "IntegerField": "int",
        "DateTimeField": "datetime",
        "DateField": "date",
        "CharField": "string",
        "TextField": "string",
        "BooleanField": "bool",
        "JsonField": "json",
    }

    for table in db.initialize_db():
        table_name = table._meta.table_name
        class_name = table.__name__
        columns = dict()
        for key, value in table._meta.columns.items():
            if key != "id":
                columns[key] = value

        out.write(f"### {table_name} ({class_name})\n")
        out.write(
            "\n".join(map(str.strip, table.__doc__.split("\n")))
            if table.__doc__
            else ""
        )
        out.write("\n\n")

        out.write("<details>\n")
        out.write("<summary><b>Columns</b></summary>\n\n")

        out.write("| name | type | description | default value | notes |\n")
        out.write("|---|---|---|---|---|\n")

        for key, value in columns.items():
            out.write("| ")
            out.write(e(key.replace("_id", "")))
            out.write(" | ")
            typ = type(value).__name__
            if typ == "ForeignKeyField" or typ == "DeferredForeignKey":
                out.write(
                    "["
                    + e(value.rel_model.__name__ + " reference")
                    + "](#"
                    + value.rel_model._meta.table_name
                    + "-"
                    + value.rel_model.__name__.lower()
                    + ")"
                )
            else:
                out.write(e(type_map[typ]))
            out.write(" | ")
            out.write("" if value.help_text is None else e(value.help_text))
            out.write(" | ")
            if value.default is not None:
                if type(value.default).__name__ == "builtin_function_or_method":
                    out.write(e(str(value.default).split(" ")[2] + "()"))
                else:
                    out.write(e(repr(value.default)))
            out.write(" | ")
            out.write(" |\n")
        out.write("\n")

        out.write("</details>\n\n")


document(open("Database.md", "w"))
