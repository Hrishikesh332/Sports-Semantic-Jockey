from io import BytesIO

from flask import Response, send_file, send_from_directory


def send_directory_path(directory, path, **kwargs):
    return send_from_directory(directory, path.name, **kwargs)


def send_jpeg_bytes(content):
    return send_file(BytesIO(content), mimetype="image/jpeg")


def send_mp4_bytes(content, *, download_name, as_attachment):
    return send_file(
        BytesIO(content),
        mimetype="video/mp4",
        as_attachment=as_attachment,
        download_name=download_name,
    )


def send_mp4_path(path, *, download_name, as_attachment):
    return send_file(
        path,
        mimetype="video/mp4",
        as_attachment=as_attachment,
        download_name=download_name,
    )


def send_svg_text(content):
    return Response(content, mimetype="image/svg+xml")
