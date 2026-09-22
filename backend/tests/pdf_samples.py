from io import BytesIO

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))


def pdf_bytes(text='这是一篇不含身份信息的论文。', *, author='', blank=False, image=False, inline_image=False, encrypt=False, xmp=None):
    output = BytesIO()
    c = canvas.Canvas(output, pageCompression=1, invariant=1)
    c.setAuthor(author)
    c.setTitle('Anonymous paper')
    c.setFont('STSong-Light', 12)
    if not blank:
        c.drawString(50, 700, text)
    if image:
        c.drawImage(ImageReader(Image.new('RGB', (10, 10), 'white')), 50, 400)
    if inline_image: c.drawInlineImage(Image.new('RGB', (10, 10), 'white'), 50, 400)
    c.showPage()
    c.save()
    raw = output.getvalue()
    if encrypt or xmp:
        writer = PdfWriter(clone_from=PdfReader(BytesIO(raw)))
        if encrypt:
            writer.encrypt('secret')
        if xmp:
            stream = DecodedStreamObject()
            stream.set_data(xmp.encode('utf-8'))
            stream[NameObject('/Type')] = NameObject('/Metadata')
            stream[NameObject('/Subtype')] = NameObject('/XML')
            writer.root_object[NameObject('/Metadata')] = writer._add_object(stream)
        out = BytesIO()
        writer.write(out)
        raw = out.getvalue()
    return raw
